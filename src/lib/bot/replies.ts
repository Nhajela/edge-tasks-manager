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

export const added = (id: number) => `➕ Added to #${id}`;

export const alreadyTracked = (id: number) => `That message is already #${id}.`;

export const alreadyIn = (id: number) => `That message is already in #${id}.`;

export const prompt = (assignee: Person | null) => `What should ${name(assignee)} do? Reply to this message with the details.`;

export const done = (r: Request) => `✅ #${r.id} is done: <b>${esc(r.title)}</b>`;

/** After /done /doing /waiting /decline /reopen. `behalf`: someone other than the assignee closed it. */
export const statusSet = (r: Request, behalf?: { by: Person | null; assignee: Person | null }) =>
  (r.status === "done" ? done(r) : `#${r.id} is now ${esc(r.customStatus || STATUS_LABEL[r.status])}: <b>${esc(r.title)}</b>`) +
  (behalf ? `\nClosed by ${name(behalf.by)} on behalf of ${name(behalf.assignee)}.` : "");

export const cantChange = (r: Request, requester: Person | null, assignee: Person | null) =>
  `Only ${name(assignee)} or ${name(requester)} can change #${r.id}.`;

export const markDone = (id: number) => `Mark #${id} done?`;

export const promptExpired = (assignee: Person | null) =>
  `That prompt expired. Send <code>/request ${name(assignee)} …</code> again.`;

export type Section = { title: string; count: number; items: Request[] };
export type Block = { heading: string; total: number; sections: Section[] };

/**
 * Grouped list (SPEC "Grouping"): per block "<b>For you</b> (4 open)", then each bucket "<b>Act</b> (2)" with its
 * lines, at most `max` lines in all; whatever didn't fit is counted with a pointer to the dashboard.
 */
export function grouped(blocks: Block[], now: Date, empty: string, max: number) {
  let left = max;
  const out: string[] = [];
  for (const b of blocks) {
    const parts: string[] = [];
    for (const s of b.sections) {
      const shown = s.items.slice(0, left);
      left -= shown.length;
      if (shown.length) parts.push(`<b>${esc(s.title)}</b> (${s.count})\n${shown.map((r) => line(r, now)).join("\n")}`);
    }
    if (parts.length) out.push([`<b>${esc(b.heading)}</b> (${b.total} open)`, ...parts].join("\n\n"));
  }
  if (!out.length) return empty;
  const more = blocks.reduce((n, b) => n + b.total, 0) - (max - left);
  return out.join("\n\n") + (more > 0 ? `\n\n…and ${more} more on the dashboard` : "");
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
  "",
  "Reply to any message of a request:",
  "/done · /doing · /waiting &lt;why&gt; · /decline &lt;why&gt; · /reopen",
].join("\n");

export const HELP_MENTION = `Mention me with an @person and what you need, e.g. <code>@${esc(BOT_USERNAME || "bot")} @bob fix the projector</code>. Send /help for more.`;

export const usage = {
  request: "What's the request? E.g. <code>/request @bob fix the projector</code>",
  append: "Reply to a message with /append to add it to that person's latest request, or use <code>/append 12</code>.",
  with: "Who with? E.g. <code>/with @bob</code>",
  status: "Which request? E.g. <code>/status 12</code>",
  done: "Reply to a request message, or use <code>/done 12</code>.",
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
