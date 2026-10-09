import type { DbClient } from "@/db";
import { actorFromTelegram, systemActor } from "@/lib/actor";
import { CLOSED, SITE_URL } from "@/lib/constants";
import { appLink } from "@/lib/links";
import { claimCode, isPendingCode } from "@/lib/login";
import { messageLink } from "@/lib/messageLink";
import type { Person, Session } from "@/lib/types";
import { PermissionError, ServiceError, errorMessage } from "@/services/errors";
import { requestUrl, type Notifier } from "@/services/notifications";
import * as people from "@/services/people";
import { groupInbox, groupRaised, type InboxBucket } from "@/services/grouping";
import * as prompts from "@/services/prompts";
import * as requests from "@/services/requests";
import { confirmationMessage } from "@/services/titler";
import type { Actor, Effect, OutgoingMessage } from "@/services/types";
import * as copy from "./replies";
import type { HandlerResult, Intent, MessageCtx, PersonRef, TgMessage, TgUser } from "./types";

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

/** Create, reply "📝 #12 for @bob", remember that reply (so replies to it land on the request), DM buttons. */
async function createAndConfirm(c: Ctx, actor: Actor, m: MessageCtx, input: requests.CreateInput): Promise<HandlerResult> {
  const res = await requests.create(c.db, actor, input);
  const id = res.request.id;
  if (res.duplicate) {
    // a Telegram retry has this very message stored; anything else is a second /request on an already-tracked message
    const retry = (await requests.findRequestByTelegramMessage(c.db, m.chat.id, m.message.message_id)) === id;
    if (!retry) await reply(c, m, copy.alreadyTracked(id), { requestId: id, buttons: [openButton(id)] });
    return result("request.duplicate", id);
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
    i.status === "done" && !i.attachments.length && i.replyToMessageId != null ? await repliedDeliverable(c, requestId, i.chat.id, i.replyToMessageId) : null;
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
