import type { Status } from "@/lib/types";
import type { AttachmentInput } from "@/services/requests";
import type { Intent, ListCommand, MessageCtx, PersonRef, TgMessage, TgUpdate } from "./types";

export type ParseCtx = {
  /** the bot's username, without @ (any case) */
  botUsername: string;
  /** SUPERADMIN_USERNAME, without @ */
  superadminUsername: string;
};

const ignore = (reason: string): Intent => ({ kind: "ignore", reason });
const LIST_COMMANDS: ListCommand[] = ["mine", "raised", "with", "status", "help"];
const STATUS_COMMANDS: Record<string, Status> = { done: "done", doing: "in_progress", waiting: "waiting", decline: "declined", reopen: "open" };
/** What a reply with no text/photo/document was, so it is still stored and later replies to it still chain. */
const MEDIA: [string, string][] = [
  ["sticker", "sticker"], ["voice", "voice note"], ["video_note", "video message"], ["video", "video"], ["animation", "GIF"],
  ["audio", "audio"], ["location", "location"], ["venue", "location"], ["poll", "poll"], ["contact", "contact"], ["dice", "dice"],
];
const APPEND_COMMANDS = ["append", "add", "more"];

const textOf = (m: TgMessage) => m.text ?? m.caption ?? "";

/** Largest photo (by area) and/or the document of one message. */
function attachmentsOf(m: TgMessage | null): AttachmentInput[] {
  if (!m) return [];
  const out: AttachmentInput[] = [];
  if (m.photo?.length) {
    const p = m.photo.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
    out.push({ messageId: m.message_id, telegramFileId: p.file_id, telegramFileUniqueId: p.file_unique_id, kind: "photo", width: p.width, height: p.height, size: p.file_size ?? null });
  }
  if (m.document) {
    const d = m.document;
    out.push({ messageId: m.message_id, telegramFileId: d.file_id, telegramFileUniqueId: d.file_unique_id, kind: "document", mime: d.mime_type ?? null, fileName: d.file_name ?? null, size: d.file_size ?? null });
  }
  return out;
}

/**
 * The explicit reply target. In forum topics Telegram points every message at the topic root: not a reply. In plain
 * supergroups message_thread_id is just the root of the reply chain, so a reply to that root is a real reply.
 */
function replyOf(m: TgMessage): TgMessage | null {
  const r = m.reply_to_message;
  if (!r || r.forum_topic_created || (m.is_topic_message && r.message_id === m.message_thread_id)) return null;
  return r;
}

/**
 * Leading assignee at `pos` in the message text: a text_mention entity (user without username) or "@username".
 * Returns the person and the text after it.
 */
function leadingPerson(m: TgMessage, pos: number): { person: PersonRef | null; rest: string } {
  const text = textOf(m);
  const start = pos + (text.slice(pos).length - text.slice(pos).trimStart().length);
  const tm = (m.entities ?? m.caption_entities ?? []).find((e) => e.type === "text_mention" && e.offset === start && e.user);
  if (tm?.user) return { person: { by: "user", user: tm.user }, rest: text.slice(start + tm.length).trim() };
  const at = /^@([A-Za-z0-9_]{3,32})\b/.exec(text.slice(start));
  if (at) return { person: { by: "username", username: at[1].toLowerCase() }, rest: text.slice(start + at[0].length).trim() };
  return { person: null, rest: text.slice(start).trim() };
}

const parseId = (s: string) => {
  const m = /^#?(\d+)\b\s*/.exec(s);
  return m ? { id: Number(m[1]), rest: s.slice(m[0].length).trim() } : { id: null, rest: s };
};

/** /request and the leading-@bot mention share these rules (SPEC "Telegram bot"). */
function requestIntent(c: MessageCtx, via: "command" | "mention", afterTrigger: number): Intent {
  const { person, rest } = leadingPerson(c.message, afterTrigger);
  const replied = replyOf(c.message);
  // a bot is never the requester: replying to a bot message is like not replying
  const source = replied && !replied.from?.is_bot ? replied : null;
  const attachments = [...attachmentsOf(c.message), ...attachmentsOf(source)];
  if (source) {
    // "give this to me": the replied-to author asks, the replier (or the named @person) does it
    const requester: PersonRef = { by: "user", user: source.from ?? c.from };
    return { kind: "request", via, requester, assignee: person ?? { by: "user", user: c.from }, body: textOf(source).trim(), note: rest || null, source, attachments, ...c };
  }
  if (!rest && !attachments.length) return person ? { kind: "prompt", assignee: person, ...c } : { kind: "help-mention", ...c };
  return { kind: "request", via, requester: { by: "user", user: c.from }, assignee: person ?? { by: "superadmin" }, body: rest, note: null, source: null, attachments, ...c };
}

function statusIntent(c: MessageCtx, status: Status, args: string, reply: TgMessage | null): Intent {
  // in a thread a leading number is usually the note ("/done 3 spare cables"): only "#12" or a lone "12" is an id there
  const { id, rest } = !reply || /^#\d+\b|^\d+$/.test(args) ? parseId(args) : { id: null, rest: args };
  return { kind: "status", status, requestId: id, replyToMessageId: reply?.message_id ?? null, note: rest || null, ...c };
}

/**
 * Pure: turn a Telegram update into an Intent (SPEC "Telegram bot" parsing rules). No DB, no network.
 * Messages from bots -> ignore. The webhook route is: parseUpdate -> handleIntent -> after(runEffects(result.effects)).
 */
export function parseUpdate(update: TgUpdate, ctx: ParseCtx): Intent {
  const bot = ctx.botUsername.toLowerCase();

  if (update.callback_query) {
    const q = update.callback_query;
    const code = q.data?.startsWith("login:") ? q.data.slice(6) : "";
    if (!code) return ignore("unknown callback");
    return { kind: "login-confirm", code, callbackQueryId: q.id, from: q.from, message: q.message ?? null };
  }
  if (update.my_chat_member) {
    const u = update.my_chat_member;
    return { kind: "membership", chat: u.chat, from: u.from, status: u.new_chat_member.status };
  }
  const message = update.message;
  if (!message) return ignore(update.edited_message ? "edited message" : "unsupported update");
  const from = message.from;
  if (!from) return ignore("no sender");
  if (from.is_bot) return ignore("from a bot");
  if (message.chat.type === "channel") return ignore("channel");

  const c: MessageCtx = { message, chat: message.chat, from };
  const text = textOf(message);
  const reply = replyOf(message);

  const cmd = /^\/([A-Za-z0-9_]+)(?:@([A-Za-z0-9_]+))?(?=\s|$)/.exec(text);
  if (cmd) {
    if (cmd[2] && cmd[2].toLowerCase() !== bot) return ignore("command for another bot");
    const name = cmd[1].toLowerCase();
    const after = cmd[0].length;
    const args = text.slice(after).trim();

    if (name === "request") return requestIntent(c, "command", after);
    // /start logs you in and marks you DM-able: only meaningful in a DM with the bot
    if (name === "start") return message.chat.type === "private" ? { kind: "start", code: args.split(/\s+/)[0] || null, ...c } : ignore("start outside DM");
    if (STATUS_COMMANDS[name]) return statusIntent(c, STATUS_COMMANDS[name], args, reply);
    if (APPEND_COMMANDS.includes(name)) {
      const { id, rest } = parseId(args);
      // replying to a human: attach that message; replying to the bot (or no reply): the command itself is the payload
      const human = reply && !reply.from?.is_bot ? reply : null;
      const payload = human ?? message;
      const appendText = [human ? textOf(human).trim() : "", rest].filter(Boolean).join("\n\n");
      return { kind: "append", requestId: id, replyTo: reply, payload, text: appendText, attachments: [...attachmentsOf(human), ...attachmentsOf(message)], ...c };
    }
    if ((LIST_COMMANDS as string[]).includes(name)) {
      const command = name as ListCommand;
      const who = command === "with" ? (leadingPerson(message, after).person ?? (reply?.from ? { by: "user" as const, user: reply.from } : null)) : null;
      const requestId = command === "status" ? parseId(args).id : null;
      return { kind: "list", command, who, requestId, ...c };
    }
    return ignore("unknown command");
  }

  // a bot mention counts only as the first thing in the message ("thanks @bot" is not a trigger)
  const lead = text.length - text.trimStart().length;
  const mention = new RegExp(`^@${bot}(?![A-Za-z0-9_])[\\s,:]*`, "i").exec(text.slice(lead));
  if (mention) {
    const after = text.slice(lead + mention[0].length);
    const kw = /^(done|on it)(?![A-Za-z0-9_])[\s,:.!-]*/i.exec(after);
    if (kw) return statusIntent(c, kw[1].toLowerCase() === "done" ? "done" : "in_progress", after.slice(kw[0].length).trim(), reply);
    return requestIntent(c, "mention", lead + mention[0].length);
  }

  if (!reply) return ignore("not addressed to the bot");
  const attachments = attachmentsOf(message);
  const bare = !text.trim() && !attachments.length;
  // a sticker/voice note to the bot can't answer a prompt or append: it is only ever a thread message
  if (reply.from?.is_bot && reply.from.username?.toLowerCase() === bot && !bare)
    return { kind: "pending-reply", botMessageId: reply.message_id, text: text.trim(), attachments, ...c };
  // the handler keeps it only if the replied message is tied to a request (findRequestByTelegramMessage); stickers,
  // voice notes etc. are stored too, so a later reply to them still chains back to the request
  const media = MEDIA.find(([k]) => k in message)?.[1] ?? "message";
  return { kind: "thread", replyToMessageId: reply.message_id, text: bare ? `(${media})` : text.trim(), attachments, ...c };
}
