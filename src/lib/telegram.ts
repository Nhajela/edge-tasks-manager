import { db } from "@/db";
import * as botMessages from "@/services/botMessages";
import type { Notifier } from "@/services/notifications";
import * as people from "@/services/people";
import type { OutgoingMessage } from "@/services/types";
import { SITE_URL } from "./constants";
import { escapeHtml } from "./html";
import { systemActor } from "./actor";

export { escapeHtml };

export type Button = { text: string; url: string } | { text: string; callback_data: string };

/** messageId is Telegram's id for the sent message (a fake one in dev, so reply-to-bot flows can be tested). */
export type SendResult = { ok: true; messageId?: number } | { ok: false; blocked: boolean; description?: string };

export type SendOptions = {
  /** Reply to this message (in the same chat). Still sends if it was deleted. */
  replyTo?: number | null;
  /** Forum topic id in supergroups with topics. */
  threadId?: number | null;
  /** ties the sent message to a request (bot_messages.request_id) so replies to it thread into the request */
  requestId?: number | null;
  /** send as a photo with the html as its caption (the done deliverable) */
  photo?: OutgoingMessage["photo"];
};

/**
 * Inline button URLs must be https://. (tg://user?id= buttons fail with BUTTON_USER_PRIVACY_RESTRICTED
 * for many users, so people without a @username are linked in the message text instead.)
 */
const buttonUrlOk = (url: string) => url.startsWith("https://");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Local dev never messages real people; set TELEGRAM_SEND_IN_DEV=1 to really send. */
const devMuted = () => process.env.NODE_ENV !== "production" && !process.env.TELEGRAM_SEND_IN_DEV;

type TgResponse = {
  ok: boolean;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
  result?: { message_id?: number };
};

async function post(token: string, method: string, body: Record<string, unknown>): Promise<TgResponse> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as TgResponse;
}

export type MessageKind = OutgoingMessage["kind"];

/** Record a send attempt in bot_messages. Never throws: logging must not break sending. */
async function logMessage(
  chatId: string | number,
  kind: MessageKind,
  text: string,
  ok: boolean,
  messageId?: number,
  error?: string,
  requestId?: number | null,
) {
  try {
    await botMessages.log(db(), { chatId: Number(chatId), kind, ok, telegramMessageId: messageId ?? null, error: error ?? null, text, requestId });
  } catch (e) {
    console.error("bot_messages log failed", e);
  }
}

export async function sendMessage(
  chatId: string | number,
  html: string,
  buttons: Button[] = [],
  kind: MessageKind = "bot_reply",
  opts: SendOptions = {},
): Promise<SendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  let text = html;
  const body: Record<string, unknown> = {
    chat_id: chatId,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  };
  if (opts.replyTo) body.reply_parameters = { message_id: opts.replyTo, allow_sending_without_reply: true };
  if (opts.threadId) body.message_thread_id = opts.threadId;
  const usable = buttons.filter((b) => !("url" in b) || buttonUrlOk(b.url));
  const asText = buttons.filter((b) => "url" in b && !b.url.startsWith("tg://") && !buttonUrlOk(b.url)) as {
    text: string;
    url: string;
  }[];
  if (usable.length) body.reply_markup = { inline_keyboard: usable.map((b) => [b]) };
  if (asText.length) text += "\n\n" + asText.map((b) => `${b.text}: ${b.url}`).join("\n");
  body.text = text.slice(0, 4096);
  // captions max out at 1024 chars: a longer message goes out as plain text
  const photo = opts.photo && text.length <= 1024 ? ("fileId" in opts.photo ? opts.photo.fileId : opts.photo.url) : null;
  if (process.env.NODE_ENV !== "production") {
    // ponytail: fake ids are ms-based, unique enough for one dev box
    const fakeId = Date.now() % 2_000_000_000;
    await devOutbox({ chatId, text, kind, replyTo: opts.replyTo ?? null, buttons: usable, messageId: fakeId, ...(photo ? { photo } : {}) });
    if (devMuted()) {
      await logMessage(chatId, kind, text, true, fakeId, "dev: not sent", opts.requestId);
      return { ok: true, messageId: fakeId };
    }
  }
  if (!token) {
    console.warn("TELEGRAM_BOT_TOKEN not set; skipping message");
    return { ok: false, blocked: false, description: "no token" };
  }

  try {
    let json = photo ? await post(token, "sendPhoto", { ...body, text: undefined, link_preview_options: undefined, photo, caption: text }) : null;
    // a photo Telegram won't take (stale file id, bad caption, rate limit) still goes out as text; 403 is final
    if (!json || (!json.ok && json.error_code !== 403)) json = await post(token, "sendMessage", body);
    // rate limited: wait as told (capped) and retry once
    if (!json.ok && json.error_code === 429) {
      await sleep(Math.min((json.parameters?.retry_after ?? 1) * 1000, 10_000));
      json = await post(token, "sendMessage", body);
    }
    // a rejected button (e.g. privacy-restricted) shouldn't lose the message: retry without the keyboard
    if (!json.ok && json.error_code === 400 && body.reply_markup && /button|reply markup/i.test(json.description ?? "")) {
      delete body.reply_markup;
      json = await post(token, "sendMessage", body);
    }
    await logMessage(chatId, kind, text, json.ok, json.result?.message_id, json.ok ? undefined : `${json.error_code}: ${json.description}`, opts.requestId);
    if (json.ok) return { ok: true, messageId: json.result?.message_id };
    // 403: user blocked the bot or never started it
    return { ok: false, blocked: json.error_code === 403, description: json.description };
  } catch (e) {
    console.error("telegram sendMessage failed", e);
    await logMessage(chatId, kind, text, false, undefined, e instanceof Error ? e.message : String(e), opts.requestId);
    return { ok: false, blocked: false };
  }
}


export function siteUrl(path = "/") {
  return new URL(path, SITE_URL).toString();
}

/** Fire-and-forget Bot API call for things like answerCallbackQuery / editMessageText. Muted in dev like sendMessage. */
export async function tg(method: string, body: Record<string, unknown>) {
  if (devMuted()) {
    await devOutbox({ method, ...body });
    return { ok: true } as TgResponse;
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    return await post(token, method, body);
  } catch (e) {
    console.error(`telegram ${method} failed`, e);
    return null;
  }
}

/** Dev only: append outgoing bot calls to $TMP/edge-tasks-outbox.jsonl so flows can be checked locally. */
async function devOutbox(entry: Record<string, unknown>) {
  try {
    const [{ appendFile }, { tmpdir }, { join }] = await Promise.all([
      import("node:fs/promises"),
      import("node:os"),
      import("node:path"),
    ]);
    await appendFile(join(tmpdir(), "edge-tasks-outbox.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
  } catch {}
}

/** Production Notifier: sends via the Bot API; a 403 on a DM means they blocked the bot, so stop DMing them. */
export const telegramNotifier: Notifier = {
  async send(m) {
    const res = await sendMessage(m.chatId, m.html, m.buttons ?? [], m.kind, { replyTo: m.replyTo, requestId: m.requestId, photo: m.photo });
    if (!res.ok && res.blocked && m.recipientPersonId)
      await people.setStartedBot(db(), systemActor(), m.recipientPersonId, false).catch((e) => console.error(e));
    return res;
  },
};
