/**
 * Who to tell about a change, and what to say. Pure: returns messages; adapters send them through a Notifier
 * (src/lib/telegram.ts telegramNotifier in prod, a capturing notifier in tests). Rules (SPEC "Notifications"):
 * - assigned: DM the assignee if they started the bot.
 * - status/comment: tell the other side (requester acts → assignee, anyone else → requester); DM if possible,
 *   else reply in the original group thread, but only for done/declined and comments marked notify.
 * - never notify the actor about their own action. Thread replies never ping Telegram.
 */
import { SITE_URL, STATUS_LABEL } from "@/lib/constants";
import { escapeHtml } from "@/lib/html";
import { displayName } from "@/lib/names";
import type { Person, Request, Status } from "@/lib/types";
import type { Actor, OutgoingMessage } from "./types";

export type NotifyEvent =
  | { kind: "assigned" }
  | { kind: "status"; status: Status; customStatus?: string | null; note?: string | null }
  | { kind: "comment"; text: string; notify: boolean };

export interface Notifier {
  send(message: OutgoingMessage): Promise<{ ok: true; messageId?: number } | { ok: false; blocked: boolean; description?: string }>;
}

export const requestUrl = (id: number) => `${SITE_URL}/r/${id}`;

const canDm = (p: Person | null) => Boolean(p?.startedBot && p.telegramId);
const quote = (s: string) => escapeHtml(s.length > 500 ? s.slice(0, 500) + "…" : s);

export function decide(
  actor: Actor,
  request: Request,
  parties: { requester: Person | null; assignee: Person | null },
  event: NotifyEvent,
): OutgoingMessage[] {
  const { requester, assignee } = parties;
  const title = escapeHtml(request.title);
  const tag = `#${request.id}`;
  const buttons = [{ text: `Open ${tag}`, url: requestUrl(request.id) }];
  const by = escapeHtml(actor.displayName);

  if (event.kind === "assigned") {
    if (!assignee || assignee.id === actor.personId || !canDm(assignee)) return [];
    return [
      {
        chatId: assignee.telegramId!,
        kind: "assigned",
        requestId: request.id,
        recipientPersonId: assignee.id,
        html: `📝 ${escapeHtml(displayName(requester))} asked you: <b>${title}</b> (${tag})`,
        buttons,
      },
    ];
  }

  const target = actor.personId != null && actor.personId === request.requesterId ? assignee : requester;
  if (!target || target.id === actor.personId) return [];

  let line: string;
  let groupWorthy: boolean;
  if (event.kind === "status") {
    const label = escapeHtml(event.customStatus || STATUS_LABEL[event.status].toLowerCase());
    const icon = event.status === "done" ? "✅" : event.status === "declined" ? "🚫" : "🔄";
    line = `${icon} ${tag} is ${event.status === "done" ? "done" : label}: <b>${title}</b>${event.note ? `\n${by}: ${quote(event.note)}` : ""}`;
    groupWorthy = event.status === "done" || event.status === "declined";
  } else {
    if (!event.notify) return [];
    line = `💬 ${by} on ${tag} <b>${title}</b>:\n${quote(event.text)}`;
    groupWorthy = true;
  }

  if (canDm(target))
    return [
      {
        chatId: target.telegramId!,
        kind: event.kind,
        requestId: request.id,
        recipientPersonId: target.id,
        html: line,
        buttons,
      },
    ];
  if (groupWorthy && request.chatId)
    return [
      {
        chatId: request.chatId,
        kind: "group_fallback",
        requestId: request.id,
        replyTo: request.sourceMessageId,
        html: `${escapeHtml(displayName(target))}, ${line}`,
        buttons,
      },
    ];
  return [];
}
