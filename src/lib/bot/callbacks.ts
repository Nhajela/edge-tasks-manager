/**
 * Bot callback buttons and the /start login flow (copied from eci-travel-coop's webhook).
 * - `login:<code>`: "Yes, log me in" after /start <code>.
 * - `st:<id>:<status>`: the assignee's "On it" / "Done" buttons on the assignment DM (see notifications.decide).
 */
import type { DbClient } from "@/db";
import { actorFromTelegram } from "@/lib/actor";
import { claimCode, createClaimedCode, isPendingCode } from "@/lib/login";
import { escapeHtml, sendMessage, siteUrl, tg, type Button } from "@/lib/telegram";
import type { Session, Status } from "@/lib/types";
import { errorMessage } from "@/services/errors";
import { requestUrl } from "@/services/notifications";
import * as requests from "@/services/requests";
import type { Effect } from "@/services/types";
import type { HandlerResult, Intent, TgCallbackQuery, TgUser } from "./types";

const APP = "Edge Tasks";

const USERNAME_NUDGE =
  "\n\nℹ️ You don't have a Telegram @username, so people can't assign you requests by @name. " +
  "Set one in Telegram → Settings → Username, then send /start again.";

/** Statuses the assignee can set from the DM buttons. */
const BUTTON_STATUS: Record<string, { status: Status; done: string }> = {
  in_progress: { status: "in_progress", done: "🔄 You're on it." },
  done: { status: "done", done: "✅ You marked this done." },
};

/** "st:12:done" -> {requestId: 12, status: "done"}; anything else -> null. */
export function parseStatusData(data: string | undefined): { requestId: number; status: Status } | null {
  const m = /^st:(\d+):(\w+)$/.exec(data ?? "");
  if (!m || !BUTTON_STATUS[m[2]]) return null;
  return { requestId: Number(m[1]), status: BUTTON_STATUS[m[2]].status };
}

function toSession(from: TgUser): Session {
  return { telegramId: String(from.id), username: from.username ?? null, firstName: from.first_name ?? "" };
}

async function magicButton(s: Session, text = `Open ${APP}`): Promise<Button> {
  const code = await createClaimedCode(s);
  return { text, url: siteUrl(`/login?code=${code}`) };
}

/** Every callback_query: returns effects (status notifications) for the route to run in after(). */
export async function handleCallback(db: DbClient, cb: TgCallbackQuery): Promise<Effect[]> {
  if (cb.from.is_bot) return [];
  if (cb.data?.startsWith("login:")) {
    await handleLogin(db, cb, cb.data.slice("login:".length));
    return [];
  }
  const fw = /^fw:(new|\d+)$/.exec(cb.data ?? "");
  if (fw) {
    // "new request, or add to one?" after a forward (handlers.onForwardChoice)
    const { handleIntent } = await import("./handlers");
    const { telegramNotifier } = await import("@/lib/telegram");
    const choice = fw[1] === "new" ? ("new" as const) : Number(fw[1]);
    const res = await handleIntent(db, { kind: "forward-choice", choice, callbackQueryId: cb.id, from: cb.from, message: cb.message ?? null }, { notifier: telegramNotifier, now: () => new Date() });
    return res.effects;
  }
  const st = parseStatusData(cb.data);
  if (st) return handleStatus(db, cb, st);
  await tg("answerCallbackQuery", { callback_query_id: cb.id });
  return [];
}

async function handleLogin(db: DbClient, cb: TgCallbackQuery, code: string) {
  const s = toSession(cb.from);
  const ok = await claimCode(code, s);
  // they're talking to the bot, so we can DM them from now on
  if (ok) await actorFromTelegram(db, cb.from, { startedBot: true }).catch((e) => console.error(e));
  await tg("answerCallbackQuery", {
    callback_query_id: cb.id,
    text: ok ? "Logged in! Head back to your browser." : "That login expired. Sending you a fresh link.",
  });
  if (ok && cb.message) {
    await tg("editMessageText", {
      chat_id: cb.message.chat.id,
      message_id: cb.message.message_id,
      parse_mode: "HTML",
      text: `✅ You're logged in, ${escapeHtml(s.firstName)}! Head back to your browser.\n\nIf that page doesn't update, use the button below.`,
      reply_markup: { inline_keyboard: [[await magicButton(s, `Continue to ${APP}`)]].filter(() => siteUrl().startsWith("https://")) },
    });
  } else if (!ok) {
    await sendMessage(s.telegramId, "Here's a fresh login link (works for 30 min).", [await magicButton(s)]);
  }
}

async function handleStatus(db: DbClient, cb: TgCallbackQuery, st: { requestId: number; status: Status }): Promise<Effect[]> {
  const answer = (text: string) => tg("answerCallbackQuery", { callback_query_id: cb.id, text });
  try {
    const { actor, person } = await actorFromTelegram(db, cb.from);
    const before = await requests.getById(db, actor, st.requestId);
    if (before.assigneeId !== person.id) {
      await answer("Only the assignee can use these buttons.");
      return [];
    }
    // a double tap must not write a second audit row or ping twice
    const res = before.status === st.status ? { request: before, effects: [] } : await requests.setStatus(db, actor, st.requestId, { status: st.status });
    await answer(BUTTON_STATUS[st.status].done);
    if (cb.message) {
      const buttons: Button[][] = [];
      if (st.status === "in_progress") buttons.push([{ text: "✅ Done", callback_data: `st:${st.requestId}:done` }]);
      if (requestUrl(st.requestId).startsWith("https://")) buttons.push([{ text: `Open #${st.requestId}`, url: requestUrl(st.requestId) }]);
      const original = cb.message.text ?? cb.message.caption ?? `#${st.requestId}`;
      await tg("editMessageText", {
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        parse_mode: "HTML",
        text: `${escapeHtml(original)}\n\n${BUTTON_STATUS[st.status].done}`,
        reply_markup: { inline_keyboard: buttons },
      });
    }
    return res.effects;
  } catch (e) {
    await answer(errorMessage(e));
    return [];
  }
}

/**
 * /start [code] in a DM. Deep link from "Log in" on the site: ask for an explicit tap so a login link someone else
 * generated can't silently log *their* browser in as you. Otherwise a welcome and a fresh magic link.
 */
export async function handleStart(db: DbClient, intent: Extract<Intent, { kind: "start" }>): Promise<HandlerResult> {
  const s = toSession(intent.from);
  await actorFromTelegram(db, intent.from, { startedBot: true });
  const nudge = s.username ? "" : USERNAME_NUDGE;
  const code = intent.code;

  if (code && (await isPendingCode(code))) {
    await sendMessage(
      s.telegramId,
      `🔐 <b>Log in to ${APP} in your browser?</b>\n\n` +
        `Only tap if <i>you</i> just pressed "Log in" on the site. Never tap a login link someone sent you.` +
        nudge,
      [{ text: "✅ Yes, log me in", callback_data: `login:${code}` }],
      "login",
    );
    return { outcome: "start.login-prompt", effects: [] };
  }

  const expired = code ? "That login link expired, here's a fresh one.\n\n" : "";
  await sendMessage(
    s.telegramId,
    `${expired}👋 Hey ${escapeHtml(s.firstName)}! I turn Telegram messages into requests for people at Edge City India.\n\n` +
      `In any group I'm in: <code>/request @bob fix the projector</code>, or reply to a message with /request.\n` +
      `/mine: requests for you · /raised: requests you made · /help: more\n\n` +
      `Tap below to open your dashboard (link works once, for 30 min).` +
      nudge,
    [await magicButton(s)],
    "login",
  );
  return { outcome: code ? "start.expired" : "start.welcome", effects: [] };
}
