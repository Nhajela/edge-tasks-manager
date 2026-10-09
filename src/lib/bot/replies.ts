/** Everything the bot says (HTML, Telegram parse_mode). Kept in one place so the copy is easy to review. */
import { BOT_USERNAME, STATUS_LABEL } from "@/lib/constants";
import { dueLabel } from "@/lib/format";
import { escapeHtml as esc } from "@/lib/html";
import { displayName } from "@/lib/names";
import type { Person, Request } from "@/lib/types";

const name = (p: Person | null) => esc(displayName(p));

/** "#12 Fix the projector — Doing · due Fri" (custom label wins over the status name; due in IST). */
export function line(r: Request, now: Date) {
  const due = r.status === "done" || r.status === "declined" ? null : dueLabel(r.dueAt, now);
  return `#${r.id} ${esc(r.title)} — ${esc(r.customStatus || STATUS_LABEL[r.status])}${due ? ` · ${due.text}` : ""}`;
}

export const created = (r: Request, assignee: Person | null) => `📝 <b>#${r.id}</b> for ${name(assignee)}: ${esc(r.title)}`;

export const added = (id: number) => `➕ Added to #${id}`;

export const alreadyTracked = (id: number) => `That message is already #${id}.`;

export const prompt = (assignee: Person | null) => `What should ${name(assignee)} do? Reply to this message with the details.`;

export const done = (r: Request) => `✅ #${r.id} is done: <b>${esc(r.title)}</b>`;

export function list(heading: string, items: Request[], total: number, now: Date, empty: string) {
  if (!items.length) return empty;
  const more = total > items.length ? `\n…and ${total - items.length} more on the dashboard` : "";
  return `<b>${esc(heading)}</b> (${total})\n${items.map((r) => line(r, now)).join("\n")}${more}`;
}

export const status = (r: Request, requester: Person | null, assignee: Person | null, now: Date) =>
  `${line(r, now)}\n${name(requester)} → ${name(assignee)}`;

export const HELP = [
  "<b>Ask anyone for something</b>",
  "/request @bob fix the projector: ask @bob",
  "/request fix the projector: ask the organisers",
  "Reply to a message with /request: you take it on",
  "/append (reply to a message): add it to their latest request",
  "",
  "/mine: open requests for you",
  "/raised: open requests you asked for",
  "/with @bob: open requests between you and @bob",
  "/status 12 · /done 12",
].join("\n");

export const HELP_MENTION = `Mention me with an @person and what you need, e.g. <code>@${esc(BOT_USERNAME || "bot")} @bob fix the projector</code>. Send /help for more.`;

export const usage = {
  request: "What's the request? E.g. <code>/request @bob fix the projector</code>",
  append: "Reply to a message with /append to add it to that person's latest request, or use <code>/append 12</code>.",
  with: "Who with? E.g. <code>/with @bob</code>",
  status: "Which request? E.g. <code>/status 12</code>",
  done: "Which request? E.g. <code>/done 12</code>",
};

export const noAppendTarget = "I couldn't find an open request to add this to. Try <code>/append 12</code>.";

export const empty = {
  mine: "Nothing open for you. 🎉",
  raised: "You have no open requests.",
  with: "Nothing open between you two.",
};

export const loginPrompt =
  `🔐 <b>Log in to Edge Tasks in your browser?</b>\n\n` +
  `Only tap if <i>you</i> just pressed "Log in" on the site. Never tap a login link someone sent you.`;

export const welcome = (firstName: string, expired: boolean) =>
  `${expired ? "That login link expired, here's a fresh one.\n\n" : ""}👋 Hi ${esc(firstName || "there")}! ` +
  `I keep track of requests at Edge City India. I'll message you here when someone asks you for something.\n\n` +
  `${HELP}\n\nTap below to open your requests (link works once).`;

export const loggedIn = (firstName: string) => `✅ You're logged in, ${esc(firstName || "there")}! Head back to your browser.`;

export const freshLink = "That login expired. Here's a fresh link.";

export const privacyWarning = (chatTitle: string | undefined) =>
  `⚠️ I was added to <b>${esc(chatTitle ?? "a group")}</b> but can't read its messages, so reply threads won't be captured. ` +
  `Make me an admin there, or turn privacy mode off in BotFather (/setprivacy → Disable) and re-add me.`;
