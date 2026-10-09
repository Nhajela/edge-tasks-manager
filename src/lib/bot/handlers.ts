import type { DbClient } from "@/db";
import { actorFromTelegram, systemActor } from "@/lib/actor";
import { CLOSED, SITE_URL } from "@/lib/constants";
import { appLink } from "@/lib/links";
import { claimCode, isPendingCode } from "@/lib/login";
import { messageLink } from "@/lib/messageLink";
import type { Person, Session } from "@/lib/types";
import { PermissionError, ServiceError, errorMessage } from "@/services/errors";
import { requestUrl, type Notifier } from "@/services/notifications";
import * as chatBuffer from "@/services/chatBuffer";
import * as people from "@/services/people";
import { groupInbox, groupRaised, type InboxBucket } from "@/services/grouping";
import * as prompts from "@/services/prompts";
import * as requests from "@/services/requests";
import { confirmationMessage } from "@/services/titler";
import type { Actor, Effect, OutgoingMessage } from "@/services/types";
import { attachmentsOf, forwardRequest } from "./parse";
import * as copy from "./replies";
import type { HandlerResult, Intent, MessageCtx, PersonRef, TgChat, TgMessage, TgUser } from "./types";

export type HandlerDeps = {
  /** sends bot replies now (the returned messageId feeds requests.setBotConfirmation / prompts.create) */
  notifier: Notifier;
  now: () => Date;
  /** raw Bot API calls that aren't messages (answerCallbackQuery, editMessageText, getMe); defaults to lib/telegram tg() */
  tg?: (method: string, body: Record<string, unknown>) => Promise<unknown>;
};

type Ctx = { db: DbClient; deps: HandlerDeps };

const LIST_LIMIT = 10;
const MINE_ORDER: InboxBucket[] = ["act", "new", "upcoming", "waiting"];
const result = (outcome: string, requestId?: number | null, effects: Effect[] = []): HandlerResult => ({ outcome, requestId, effects });
const textOf = (m: TgMessage) => m.text ?? m.caption ?? "";
const tgPerson = (u: TgUser) => ({ telegramId: u.id, username: u.username ?? undefined, firstName: u.first_name });
const session = (u: TgUser): Session => ({ telegramId: String(u.id), username: u.username ?? null, firstName: u.first_name ?? "" });
const openButton = (id: number) => ({ text: `Open #${id}`, url: requestUrl(id) });

/**
 * Execute an Intent: resolve the Actor (actorFromTelegram), call services, send the bot's replies through
 * deps.notifier, and return the services' effects for the route to run in after(). Never throws for user errors:
 * service errors become a short bot reply. Dedupe of Telegram retries comes from the services ((chat, message)).
 */
export async function handleIntent(db: DbClient, intent: Intent, deps: HandlerDeps): Promise<HandlerResult> {
  if (intent.kind === "ignore") return result("ignored");
  const c: Ctx = { db, deps };
  try {
    switch (intent.kind) {
      case "request":
        return await onRequest(c, intent);
      case "append":
        return await onAppend(c, intent);
      case "log":
        return await onLog(c, intent);
      case "forward":
        return await onForward(c, intent);
      case "forward-choice":
        return await onForwardChoice(c, intent);
      case "thread":
        return await onThread(c, intent);
      case "pending-reply":
        return await onPendingReply(c, intent);
      case "prompt":
        return await onPrompt(c, intent);
      case "status":
        return await onStatus(c, intent);
      case "list":
        return await onList(c, intent);
      case "start":
        return await onStart(c, intent);
      case "login-confirm":
        return await onLoginConfirm(c, intent);
      case "status-button":
        return await onStatusButton(c, intent);
      case "help-mention":
        await reply(c, intent, copy.HELP_MENTION);
        return result("help");
      case "membership":
        return await onMembership(c, intent);
    }
  } catch (e) {
    if (!(e instanceof ServiceError)) console.error(`bot ${intent.kind} failed`, e);
    // threads and membership changes are silent: never answer messages that weren't addressed to the bot
    if ("message" in intent && "chat" in intent && intent.kind !== "thread") await reply(c, intent, errorMessage(e)).catch(() => {});
    return result(`${intent.kind}.error`);
  }
}

// ─── helpers ─────────────────────────────────────────────

function reply(c: Ctx, m: MessageCtx, html: string, extra: Partial<OutgoingMessage> = {}) {
  return c.deps.notifier.send({ chatId: m.chat.id, kind: "bot_reply", html, replyTo: m.message.message_id, ...extra });
}

const tg = (c: Ctx) => c.deps.tg ?? (async (method: string, body: Record<string, unknown>) => (await import("@/lib/telegram")).tg(method, body));

/** The sender: a DM to the bot means we can DM them back. */
const sender = (c: Ctx, m: MessageCtx) => actorFromTelegram(c.db, m.from, m.chat.type === "private" ? { startedBot: true } : {});

async function resolve(c: Ctx, ref: PersonRef): Promise<Person> {
  if (ref.by === "user") return people.upsertFromTelegram(c.db, systemActor(), tgPerson(ref.user));
  if (ref.by === "username") return people.upsertFromTelegram(c.db, systemActor(), { username: ref.username });
  const su = await people.superadmin(c.db, systemActor());
  if (!su) throw new ServiceError("NO_ORGANISER", "No organiser is set up yet. Name someone: /request @bob …");
  return su;
}

const author = (c: Ctx, m: TgMessage) => (m.from && !m.from.is_bot ? people.upsertFromTelegram(c.db, systemActor(), tgPerson(m.from)) : null);

/**
 * Silent commands: tell only the sender, by DM, then delete their command from the group. If we can't DM them (never
 * pressed Start), say it in the group and leave the command, so they still know it worked.
 */
async function whisper(c: Ctx, m: MessageCtx, html: string, requestId?: number) {
  const buttons = requestId != null ? [openButton(requestId)] : undefined;
  const dm = await c.deps.notifier.send({ chatId: m.from.id, kind: "bot_reply", html, requestId, buttons });
  if (!dm.ok) {
    await reply(c, m, html + copy.quietNeedsStart, { requestId, buttons });
    return;
  }
  // needs the bot to be a group admin with "Delete messages"; without it the command just stays
  if (m.chat.type !== "private") await tg(c)("deleteMessage", { chat_id: m.chat.id, message_id: m.message.message_id }).catch(() => {});
}

/** Store one Telegram message in a request's thread, as its author. */
async function storeThread(c: Ctx, requestId: number, chat: TgChat, msg: TgMessage) {
  if (!msg.from || msg.from.is_bot) return;
  const { actor, person } = await actorFromTelegram(c.db, msg.from);
  const attachments = attachmentsOf(msg);
  await requests.addThreadMessage(c.db, actor, {
    requestId,
    chatId: chat.id,
    messageId: msg.message_id,
    replyToMessageId: msg.reply_to_message?.message_id ?? null,
    fromId: person.id,
    text: textOf(msg).trim() || (attachments.length ? "" : "(message)"),
    link: messageLink(chat, msg.message_id),
    attachments,
  });
}

/** SPEC "Message buffer": replies to `rootId` sent before the request existed join its thread (the command itself excluded). */
async function importReplies(c: Ctx, requestId: number, m: MessageCtx, rootId: number) {
  for (const r of (await chatBuffer.repliesTo(c.db, m.chat.id, rootId, c.deps.now())) as unknown as TgMessage[])
    if (r.message_id !== m.message.message_id) await storeThread(c, requestId, m.chat, r);
}

/** Create, reply "📝 #12 for @bob", remember that reply (so replies to it land on the request), DM buttons. Silent: DM the sender only. */
async function createAndConfirm(
  c: Ctx,
  actor: Actor,
  m: MessageCtx,
  input: requests.CreateInput,
  opts: { silent?: boolean; sourceMessageId?: number } = {},
): Promise<HandlerResult> {
  const res = await requests.create(c.db, actor, input);
  const id = res.request.id;
  if (res.duplicate) {
    // a Telegram retry has this very message stored; anything else is a second /request on an already-tracked message
    const retry = (await requests.findRequestByTelegramMessage(c.db, m.chat.id, m.message.message_id)) === id;
    if (!retry) await (opts.silent ? whisper(c, m, copy.alreadyTracked(id), id) : reply(c, m, copy.alreadyTracked(id), { requestId: id, buttons: [openButton(id)] }));
    return result("request.duplicate", id);
  }
  if (opts.sourceMessageId != null) await importReplies(c, id, m, opts.sourceMessageId);
  if (opts.silent) {
    await whisper(c, m, copy.logged(id), id);
    // quiet only at creation: no assignee DM now, later changes notify as usual
    return result("request.created", id, res.effects.filter((e) => e.kind !== "notify"));
  }
  const assignee = await people.getById(c.db, res.request.assigneeId);
  // same helper the AI titler uses when it edits this message, so the wording stays stable
  const conf = confirmationMessage(res.request, assignee);
  const sent = await reply(c, m, conf.html, { kind: "created", requestId: id, buttons: conf.buttons });
  if (sent.ok && sent.messageId) await requests.setBotConfirmation(c.db, actor, id, { chatId: m.chat.id, messageId: sent.messageId });
  // the assignee DM already carries the On it / Done buttons (services/notifications)
  return result("request.created", id, res.effects);
}

async function appendTo(
  c: Ctx,
  actor: Actor,
  m: MessageCtx,
  requestId: number,
  payload: TgMessage,
  text: string,
  attachments: requests.AttachmentInput[],
  replyToMessageId = payload.reply_to_message?.message_id ?? null,
) {
  const body = text.trim() || (attachments.length ? "(attachment)" : "");
  if (!body) {
    await reply(c, m, copy.usage.append);
    return result("append.empty", requestId);
  }
  const from = await author(c, payload);
  const res = await requests.append(c.db, actor, {
    requestId,
    chatId: m.chat.id,
    messageId: payload.message_id,
    replyToMessageId,
    fromId: from?.id ?? null,
    text: body,
    link: messageLink(m.chat, payload.message_id),
    attachments,
  });
  if (res.duplicate) {
    // same request: a Telegram retry, stay quiet; another request: say where it already is
    if (res.duplicateOf != null && res.duplicateOf !== requestId) await reply(c, m, copy.alreadyIn(res.duplicateOf), { requestId: res.duplicateOf });
    return result("append.duplicate", requestId);
  }
  await reply(c, m, copy.added(requestId), { requestId });
  return result("append.added", requestId, res.effects);
}

// ─── intents ─────────────────────────────────────────────

async function onRequest(c: Ctx, i: Extract<Intent, { kind: "request" }>) {
  const { actor, person } = await sender(c, i);
  const body = [i.body.trim(), i.note?.trim()].filter(Boolean).join("\n\n") || (i.attachments.length ? "(attachment)" : "");
  if (!body) {
    await reply(c, i, copy.usage.request);
    return result("request.empty");
  }
  const [requester, assignee] = [await resolve(c, i.requester), await resolve(c, i.assignee)];
  const src = i.source;
  const srcAuthor = src ? await author(c, src) : null;
  const msg = (m: TgMessage, fromId: number | null) => ({
    messageId: m.message_id,
    replyToMessageId: m.reply_to_message?.message_id ?? null,
    fromId,
    text: textOf(m),
    link: messageLink(i.chat, m.message_id),
  });
  return createAndConfirm(c, actor, i, {
    requesterId: requester.id,
    assigneeId: assignee.id,
    body,
    chatId: i.chat.id,
    chatTitle: i.chat.title ?? null,
    messages: [...(src ? [msg(src, srcAuthor?.id ?? null)] : []), msg(i.message, person.id)],
    attachments: i.attachments,
  }, { silent: i.silent, sourceMessageId: src?.message_id });
}

const FORWARD_TARGETS = 4;

/** SPEC "Forwards": ask, replying to the forward, so the tap carries the forward back (no stored state). */
async function onForward(c: Ctx, i: Extract<Intent, { kind: "forward" }>) {
  const f = forwardRequest(i.message);
  const { actor } = await sender(c, i);
  const author = f.author ? await people.upsertFromTelegram(c.db, systemActor(), tgPerson(f.author)) : null;
  // my open requests, the ones with this person first, newest first
  const [mine, raised] = [await requests.listInbox(c.db, actor), await requests.listRaised(c.db, actor)];
  const withThem = (r: { requesterId: number; assigneeId: number }) => author != null && (r.requesterId === author.id || r.assigneeId === author.id);
  const targets = [...new Map([...mine.items, ...raised.items].filter((r) => !CLOSED.includes(r.status)).map((r) => [r.id, r])).values()]
    .sort((a, b) => Number(withThem(b)) - Number(withThem(a)) || b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, FORWARD_TARGETS);
  const preview = f.body.length > 140 ? `${f.body.slice(0, 140)}…` : f.body || "(attachment)";
  await reply(c, i, copy.forwardAsk(f.name, author != null, preview), {
    buttons: [
      { text: author ? `🆕 New request from ${f.author!.first_name}` : "🆕 New request", callback_data: "fw:new" },
      ...targets.map((r) => ({ text: `➕ #${r.id} ${r.title}`.slice(0, 64), callback_data: `fw:${r.id}` })),
    ],
  });
  return result("forward.asked");
}

async function onForwardChoice(c: Ctx, i: Extract<Intent, { kind: "forward-choice" }>) {
  const call = tg(c);
  await call("answerCallbackQuery", { callback_query_id: i.callbackQueryId }).catch(() => {});
  const edit = (html: string, requestId?: number) =>
    i.message
      ? call("editMessageText", {
          chat_id: i.message.chat.id,
          message_id: i.message.message_id,
          parse_mode: "HTML",
          text: html,
          // Telegram rejects non-https url buttons (local dev)
          reply_markup: { inline_keyboard: requestId != null && requestUrl(requestId).startsWith("https://") ? [[openButton(requestId)]] : [] },
        }).catch(() => {})
      : Promise.resolve();
  const fwd = i.message?.reply_to_message;
  if (!fwd?.forward_origin) {
    await edit(copy.forwardGone);
    return result("forward.gone");
  }
  const f = forwardRequest(fwd);
  const { actor, person: me } = await actorFromTelegram(c.db, i.from, { startedBot: true });
  const author = f.author ? await people.upsertFromTelegram(c.db, systemActor(), tgPerson(f.author)) : null;
  const body = f.body || (f.attachments.length ? "(attachment)" : "(message)");
  const message = { chatId: fwd.chat.id, messageId: fwd.message_id, fromId: (author ?? me).id, text: body, link: null };
  if (i.choice === "new") {
    const res = await requests.create(c.db, actor, {
      requesterId: (author ?? me).id,
      assigneeId: me.id,
      body,
      chatId: fwd.chat.id,
      chatTitle: null,
      messages: [message],
      attachments: f.attachments,
    });
    const id = res.request.id;
    await edit(res.duplicate ? copy.alreadyTracked(id) : copy.logged(id), id);
    // quiet at creation, like the other silent commands
    return res.duplicate ? result("request.duplicate", id) : result("request.created", id, res.effects.filter((e) => e.kind !== "notify"));
  }
  const res = await requests.append(c.db, actor, { requestId: i.choice, ...message, replyToMessageId: null, attachments: f.attachments });
  if (res.duplicate) {
    const where = res.duplicateOf ?? i.choice;
    await edit(copy.alreadyIn(where), where);
    return result("append.duplicate", where);
  }
  await edit(copy.loggedTo(i.choice), i.choice);
  return result("append.added", i.choice, res.effects);
}

async function onLog(c: Ctx, i: Extract<Intent, { kind: "log" }>) {
  const src = i.source;
  if (!src) {
    await whisper(c, i, copy.usage.log);
    return result("log.usage");
  }
  const tracked = await requests.findRequestByTelegramMessage(c.db, i.chat.id, src.message_id);
  if (tracked != null) {
    await whisper(c, i, copy.alreadyTracked(tracked), tracked);
    return result("log.already", tracked);
  }
  // Telegram drops the replied message's own reply_to_message; the buffer still has it
  const parentId = src.reply_to_message?.message_id ?? (await chatBuffer.get(c.db, i.chat.id, src.message_id))?.reply_to_message?.message_id;
  const parent = parentId != null ? await requests.findRequestByTelegramMessage(c.db, i.chat.id, parentId) : null;
  if (parent != null) {
    await storeThread(c, parent, i.chat, (await chatBuffer.get(c.db, i.chat.id, src.message_id)) as unknown as TgMessage ?? src);
    await importReplies(c, parent, i, src.message_id);
    await whisper(c, i, copy.loggedTo(parent), parent);
    return result("log.added", parent);
  }
  return onRequest(c, {
    kind: "request",
    via: "command",
    requester: { by: "user", user: src.from ?? i.from },
    assignee: { by: "user", user: i.from },
    body: textOf(src).trim(),
    note: null,
    source: src,
    attachments: attachmentsOf(src),
    silent: true,
    message: i.message,
    chat: i.chat,
    from: i.from,
  });
}

async function onAppend(c: Ctx, i: Extract<Intent, { kind: "append" }>) {
  const { actor } = await sender(c, i);
  let requestId = i.requestId;
  // a message already tied to a request (bot confirmation, thread reply, ...) appends to that request
  if (requestId == null && i.replyTo) requestId = await requests.findRequestByTelegramMessage(c.db, i.chat.id, i.replyTo.message_id);
  if (requestId == null && i.replyTo && !i.replyTo.from?.is_bot) {
    const who = await author(c, i.replyTo);
    if (who) requestId = (await requests.findAppendTarget(c.db, { authorPersonId: who.id, chatId: i.chat.id }))?.id ?? null;
  }
  if (requestId == null) {
    await reply(c, i, i.replyTo ? copy.noAppendTarget : copy.usage.append);
    return result("append.no-target");
  }
  return appendTo(c, actor, i, requestId, i.payload, i.text, i.attachments);
}

async function onThread(c: Ctx, i: Extract<Intent, { kind: "thread" }>) {
  const requestId = await requests.findRequestByTelegramMessage(c.db, i.chat.id, i.replyToMessageId);
  if (requestId == null) return result("thread.unrelated");
  const { actor, person } = await sender(c, i);
  const res = await requests.addThreadMessage(c.db, actor, {
    requestId,
    chatId: i.chat.id,
    messageId: i.message.message_id,
    replyToMessageId: i.replyToMessageId,
    fromId: person.id,
    text: i.text,
    link: messageLink(i.chat, i.message.message_id),
    attachments: i.attachments,
  });
  if (res.duplicate) return result("thread.duplicate", requestId);
  // SPEC: plain "done" is conversation, but the assignee's bare "done" gets a one-tap button instead of a guess
  if (/^(done\s*✅?|✅)$/iu.test(i.text.trim()) && res.request.assigneeId === person.id && !CLOSED.includes(res.request.status))
    await reply(c, i, copy.markDone(requestId), { requestId, buttons: [{ text: "✅ Mark done", callback_data: `st:${requestId}:done` }] });
  return result("thread.added", requestId, res.effects);
}

async function onPendingReply(c: Ctx, i: Extract<Intent, { kind: "pending-reply" }>) {
  const { actor, person } = await sender(c, i);
  // only the person who mentioned the bot can answer (consume checks); anyone else falls through and is ignored
  const p = await prompts.consume(c.db, actor, { chatId: i.chat.id, promptMessageId: i.botMessageId, now: c.deps.now() });
  if (p) {
    const body = i.text.trim() || (i.attachments.length ? "(attachment)" : "");
    if (!body) {
      await reply(c, i, copy.usage.request);
      return result("request.empty");
    }
    const sourceMessageId = p.sourceMessageId ?? i.message.message_id;
    return createAndConfirm(c, actor, i, {
      requesterId: p.requesterId,
      assigneeId: p.assigneeId,
      body,
      chatId: i.chat.id,
      chatTitle: p.chatTitle ?? i.chat.title ?? null,
      sourceMessageId,
      messageLink: messageLink(i.chat, sourceMessageId),
      messages: [
        { messageId: i.message.message_id, replyToMessageId: i.botMessageId, fromId: person.id, text: body, link: messageLink(i.chat, i.message.message_id) },
      ],
      attachments: i.attachments,
    });
  }
  const requestId = await requests.findRequestByTelegramMessage(c.db, i.chat.id, i.botMessageId);
  if (requestId == null) {
    const stale = await prompts.find(c.db, i.chat.id, i.botMessageId);
    if (!stale || stale.consumedAt) return result("pending-reply.unrelated");
    if (stale.expiresAt > c.deps.now()) return result("prompt.not-requester");
    await reply(c, i, copy.promptExpired(await people.getById(c.db, stale.assigneeId)));
    return result("prompt.expired");
  }
  // SPEC: a plain reply to any bot message of a request, the "#12 created" confirmation included, is thread; only /append appends
  return onThread(c, { kind: "thread", replyToMessageId: i.botMessageId, text: i.text, attachments: i.attachments, message: i.message, chat: i.chat, from: i.from });
}

async function onPrompt(c: Ctx, i: Extract<Intent, { kind: "prompt" }>) {
  const { actor, person } = await sender(c, i);
  // ponytail: two redeliveries racing both pass this check; fine for Telegram's sequential retries
  if (await prompts.findBySource(c.db, i.chat.id, i.message.message_id)) return result("prompt.duplicate");
  const assignee = await resolve(c, i.assignee);
  const sent = await reply(c, i, copy.prompt(assignee), { kind: "prompt" });
  if (!sent.ok || !sent.messageId) return result("prompt.unsent");
  await prompts.create(c.db, actor, {
    chatId: i.chat.id,
    promptMessageId: sent.messageId,
    requesterId: person.id,
    assigneeId: assignee.id,
    sourceMessageId: i.message.message_id,
    chatTitle: i.chat.title ?? null,
    now: c.deps.now(),
  });
  return result("prompt.created");
}

async function onList(c: Ctx, i: Extract<Intent, { kind: "list" }>) {
  const { actor } = await sender(c, i);
  const now = c.deps.now();
  // every open item, so the buckets are right; the reply itself is capped at LIST_LIMIT lines
  const filter = { status: "open" as const, limit: 500 };
  const board = (blocks: copy.Block[], empty: string, path: string) =>
    reply(c, i, copy.grouped(blocks, now, empty, LIST_LIMIT), { buttons: [{ text: "Open dashboard", url: `${SITE_URL}${path}` }] });
  // /mine leads with what to do now: Act, then New, then Upcoming (then Waiting); /raised keeps its order (Overdue first)
  const toMe = (items: requests.ListItem[]) => {
    const gs = groupInbox(items, now).groups;
    return MINE_ORDER.flatMap((k) => gs.filter((g) => g.key === k));
  };
  const byMe = (items: requests.ListItem[]) => groupRaised(items, now).groups;

  switch (i.command) {
    case "help":
      await reply(c, i, copy.HELP);
      return result("help");
    case "mine": {
      const r = await requests.listInbox(c.db, actor, filter);
      await board([{ heading: "For you", total: r.counts.open, sections: toMe(r.items) }], copy.empty.mine, "/inbox");
      return result("list.mine");
    }
    case "raised": {
      const r = await requests.listRaised(c.db, actor, filter);
      await board([{ heading: "You asked", total: r.counts.open, sections: byMe(r.items) }], copy.empty.raised, "/raised");
      return result("list.raised");
    }
    case "with": {
      if (!i.who) {
        await reply(c, i, copy.usage.with);
        return result("list.usage");
      }
      const other = await resolve(c, i.who);
      const path = other.username ? `/with/${other.username}` : "/inbox";
      const who = other.username ? `@${other.username}` : (other.firstName ?? "them");
      const { items } = await requests.listBetween(c.db, actor, other.id, filter);
      const [asked, gave] = [items.filter((r) => r.assigneeId === actor.personId), items.filter((r) => r.assigneeId !== actor.personId)];
      await board(
        [
          { heading: `${who} asked you`, total: asked.length, sections: toMe(asked) },
          { heading: `You asked ${who}`, total: gave.length, sections: byMe(gave) },
        ],
        copy.empty.with,
        path,
      );
      return result("list.with");
    }
    case "status": {
      if (i.requestId == null) {
        await reply(c, i, copy.usage.status);
        return result("list.usage");
      }
      const r = await requests.getById(c.db, actor, i.requestId);
      const [requester, assignee] = [await people.getById(c.db, r.requesterId), await people.getById(c.db, r.assigneeId)];
      await reply(c, i, copy.status(r, requester, assignee, now), { requestId: r.id, buttons: [openButton(r.id)] });
      return result("status", r.id);
    }
  }
}

/** /done /doing /waiting /decline /reopen: an explicit id, or whatever request the replied-to message belongs to. */
async function onStatus(c: Ctx, i: Extract<Intent, { kind: "status" }>) {
  const { actor, person } = await sender(c, i);
  const viaThread = i.requestId == null;
  const requestId = i.requestId ?? (i.replyToMessageId != null ? await requests.findRequestByTelegramMessage(c.db, i.chat.id, i.replyToMessageId) : null);
  if (requestId == null) {
    await reply(c, i, copy.usage.done);
    return result("status.no-target");
  }
  const note = i.note?.trim() || null;
  // SPEC: every captured message is stored (later replies to it chain, its photo kept); a stored one is a Telegram redelivery
  const message = {
    chatId: i.chat.id,
    messageId: i.message.message_id,
    replyToMessageId: i.replyToMessageId,
    fromId: person.id,
    text: textOf(i.message),
    link: messageLink(i.chat, i.message.message_id),
    attachments: i.attachments,
  };
  const storeInThread = async () => (await requests.addThreadMessage(c.db, actor, { requestId, ...message })).duplicate;
  // in the thread anyone may look; "/done 12" from outside needs view access
  const before = await requests.getById(c.db, viaThread ? systemActor() : actor, requestId);
  // SPEC deliverable: the /done's own media (setStatus picks it), else the replied-to message's photo/document/link
  const resultMessageId =
    i.status === "done" && !i.attachments.length && i.replyToMessageId != null
      ? ((await repliedDeliverable(c, requestId, i.chat.id, i.replyToMessageId)) ?? (i.requestId != null ? await storeReplied(c, actor, requestId, i) : null))
      : null;
  const newResult = resultMessageId != null && resultMessageId !== before.resultMessageId;
  if (before.status === i.status && !note && !i.attachments.length && !newResult) {
    // a second "/done" (or a redelivery): no second status row or ping, same as the DM buttons
    if (viaThread && (await storeInThread())) return result("status.duplicate", requestId);
    await reply(c, i, copy.statusSet(before), { requestId });
    return result("status.unchanged", requestId);
  }
  try {
    const res = await requests.setStatus(c.db, actor, requestId, {
      ...(i.status === "waiting" ? { status: i.status, customStatus: note } : { status: i.status, note }),
      message,
      ...(resultMessageId != null ? { result: { messageId: resultMessageId } } : {}),
    });
    if (res.duplicate) return result("status.duplicate", requestId);
    // a group fallback ("@alice, ✅ #12 is done") will say it in this chat already
    if (!res.effects.some((e) => e.kind === "notify" && e.message.chatId === i.chat.id)) {
      const behalf =
        CLOSED.includes(i.status) && person.id !== res.request.assigneeId ? { by: person, assignee: await people.getById(c.db, res.request.assigneeId) } : undefined;
      await reply(c, i, copy.statusSet(res.request, behalf), { requestId });
    }
    return result("status.set", requestId, res.effects);
  } catch (e) {
    // only inside the thread (they can see it anyway) do we name the parties; "/done 12" from a stranger gets the generic error
    if (!(e instanceof PermissionError) || !viaThread) throw e;
    // SPEC: their message still lands in the thread
    if (await storeInThread()) return result("status.duplicate", requestId);
    await reply(c, i, copy.cantChange(before, await people.getById(c.db, before.requesterId), await people.getById(c.db, before.assigneeId)), { requestId });
    return result("status.forbidden", requestId);
  }
}

/**
 * "/done 12 <note>" replying to a photo/document/link message that belongs to no request yet: store it in #12's thread
 * (its own audit row) and return its request_messages.id, so it becomes the deliverable.
 */
async function storeReplied(c: Ctx, actor: Actor, requestId: number, i: Extract<Intent, { kind: "status" }>) {
  const r = i.replied?.message;
  if (!r?.from || !(i.replied!.attachments.length || /https?:\/\/\S/i.test(textOf(r)))) return null;
  if ((await requests.findRequestByTelegramMessage(c.db, i.chat.id, r.message_id)) != null) return null;
  const { person: author } = await actorFromTelegram(c.db, r.from);
  await requests.addThreadMessage(c.db, actor, {
    requestId,
    chatId: i.chat.id,
    messageId: r.message_id,
    replyToMessageId: r.reply_to_message?.message_id ?? null,
    fromId: author.id,
    text: textOf(r),
    link: messageLink(i.chat, r.message_id),
    attachments: i.replied!.attachments,
  });
  return repliedDeliverable(c, requestId, i.chat.id, r.message_id);
}

/** request_messages.id of a conversation message (not the request itself) with a photo/document/link, else null. */
async function repliedDeliverable(c: Ctx, requestId: number, chatId: number, messageId: number) {
  const d = await requests.getDetail(c.db, systemActor(), requestId);
  const m = d.messages.find((x) => x.chatId === chatId && x.messageId === messageId && x.kind !== "original" && x.kind !== "append");
  if (!m) return null;
  const media = d.attachments.some((a) => a.chatId === chatId && a.messageId === messageId);
  return media || /https?:\/\/\S/i.test(m.text) ? m.id : null;
}

async function onStart(c: Ctx, i: Extract<Intent, { kind: "start" }>) {
  await actorFromTelegram(c.db, i.from, { startedBot: true });
  // ask for an explicit tap so a login link someone else generated can't silently log *their* browser in as you
  if (i.code && (await isPendingCode(i.code))) {
    await c.deps.notifier.send({ chatId: i.chat.id, kind: "login", html: copy.loginPrompt, buttons: [{ text: "✅ Yes, log me in", callback_data: `login:${i.code}` }] });
    return result("start.login");
  }
  const url = await appLink(session(i.from), "/inbox");
  await c.deps.notifier.send({ chatId: i.chat.id, kind: "bot_reply", html: copy.welcome(i.from.first_name ?? "", Boolean(i.code)), buttons: [{ text: "Open my requests", url }] });
  return result("start.welcome");
}

async function onLoginConfirm(c: Ctx, i: Extract<Intent, { kind: "login-confirm" }>) {
  await actorFromTelegram(c.db, i.from, { startedBot: true });
  const s = session(i.from);
  const ok = await claimCode(i.code, s);
  await tg(c)("answerCallbackQuery", {
    callback_query_id: i.callbackQueryId,
    text: ok ? "Logged in! Head back to your browser." : "That login expired. Sending you a fresh link.",
  });
  const button = { text: "Open my requests", url: await appLink(s, "/inbox") };
  if (ok && i.message)
    await tg(c)("editMessageText", {
      chat_id: i.message.chat.id,
      message_id: i.message.message_id,
      parse_mode: "HTML",
      text: copy.loggedIn(s.firstName),
      ...(button.url.startsWith("https://") ? { reply_markup: { inline_keyboard: [[button]] } } : {}),
    });
  else if (!ok) await c.deps.notifier.send({ chatId: i.from.id, kind: "login", html: copy.freshLink, buttons: [button] });
  return result(ok ? "login.ok" : "login.expired");
}

async function onStatusButton(c: Ctx, i: Extract<Intent, { kind: "status-button" }>) {
  const { actor } = await actorFromTelegram(c.db, i.from);
  try {
    const res = await requests.setStatus(c.db, actor, i.requestId, { status: i.status });
    await tg(c)("answerCallbackQuery", { callback_query_id: i.callbackQueryId, text: i.status === "done" ? `#${i.requestId} marked done ✅` : `#${i.requestId}: on it 🔄` });
    return result("status.set", i.requestId, res.effects);
  } catch (e) {
    await tg(c)("answerCallbackQuery", { callback_query_id: i.callbackQueryId, text: errorMessage(e), show_alert: true });
    throw e;
  }
}

async function onMembership(c: Ctx, i: Extract<Intent, { kind: "membership" }>) {
  // only "member" can be blind: admins always read the group
  if (i.chat.type === "private" || i.status !== "member") return result("membership.ok");
  const me = (await tg(c)("getMe", {})) as { result?: { can_read_all_group_messages?: boolean } } | null;
  if (me?.result?.can_read_all_group_messages !== false) return result("membership.ok");
  const su = await people.superadmin(c.db, systemActor());
  if (su?.telegramId && su.startedBot)
    await c.deps.notifier.send({ chatId: su.telegramId, kind: "admin_ping", html: copy.privacyWarning(i.chat.title), recipientPersonId: su.id });
  return result("membership.warned");
}
