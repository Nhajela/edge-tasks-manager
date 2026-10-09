import { CornerDownRight } from "lucide-react";
import type { ReactNode } from "react";
import { STATUS_LABEL } from "@/lib/constants";
import { formatDateTimeIST, relativeTime } from "@/lib/format";
import { displayName } from "@/lib/names";
import type { Attachment, AuditEntry, Person, Status } from "@/lib/types";
import type { DetailMessage } from "@/services/requests";
import { MessageCard } from "./MessageCard";

type QuoteSource = Pick<DetailMessage, "chatId" | "messageId" | "replyToMessageId" | "from" | "text">;

/** "↳ replying to <name>: <snippet>" for a thread message, or null when it doesn't reply to a known message. */
export function replyQuote(m: QuoteSource, all: QuoteSource[], botConfirmMessageId: number | null): { name: string; snippet: string } | null {
  if (m.replyToMessageId == null) return null;
  if (m.replyToMessageId === botConfirmMessageId) return { name: "the bot", snippet: "request confirmation" };
  const target = all.find((x) => x.chatId === m.chatId && x.messageId === m.replyToMessageId);
  if (!target) return null;
  const text = target.text.replace(/\s+/g, " ").trim();
  return { name: displayName(target.from), snippet: text.length > 80 ? text.slice(0, 80) + "…" : text };
}

const ICON: Record<Status, string> = { done: "✅", declined: "🚫", open: "↩️", in_progress: "🔧", waiting: "⏳" };

/**
 * A Telegram status command (kind 'status') as one system line, worded from the request.status audit row that recorded
 * it ("✅ @ravi marked this done: “projector fixed”"). No matching row (e.g. a refused command): the raw text.
 */
export function statusLine(
  m: Pick<DetailMessage, "messageId" | "from" | "text">,
  timeline: Pick<AuditEntry, "action" | "data">[],
  assignee: Pick<Person, "id" | "username" | "firstName">,
): string {
  const name = displayName(m.from);
  const d = timeline.find((e) => e.action === "request.status" && (e.data as { messageId?: unknown } | null)?.messageId === m.messageId)
    ?.data as { to?: Status; note?: string | null; customStatus?: string | null; onBehalfOf?: number } | undefined;
  if (!d?.to || !(d.to in STATUS_LABEL)) return `${name}: ${m.text}`;
  const verb =
    d.to === "done" ? "marked this done" : d.to === "declined" ? "declined this" : d.to === "open" ? "reopened this" : `set it to ${STATUS_LABEL[d.to]}`;
  const behalf = d.onBehalfOf != null ? ` on behalf of ${d.onBehalfOf === assignee.id ? displayName(assignee) : "the assignee"}` : "";
  const label = d.customStatus ? ` (“${d.customStatus}”)` : "";
  return `${ICON[d.to]} ${name} ${verb}${behalf}${label}${d.note ? `: “${d.note}”` : ""}`;
}

/** The reply thread: flat and chronological (readable on a phone), each message quoting what it answered. */
export function Thread({
  messages,
  all,
  attachments,
  botConfirmMessageId,
  timeline,
  assignee,
  action,
}: {
  messages: DetailMessage[];
  /** every message on the request, so a reply to the original or an append can be quoted too */
  all: DetailMessage[];
  attachments: Attachment[];
  botConfirmMessageId: number | null;
  timeline: AuditEntry[];
  assignee: Person;
  /** e.g. ⭐ Mark as deliverable, per message */
  action?: (m: DetailMessage) => ReactNode;
}) {
  if (!messages.length) return null;
  return (
    <ol className="flex flex-col gap-2.5">
      {messages.map((m) => {
        if (m.kind === "status")
          return (
            <li key={m.id} className="flex flex-wrap items-baseline justify-center gap-x-1.5 px-2 py-1 text-center text-[13.5px] text-ink-soft">
              <span className="break-words">{statusLine(m, timeline, assignee)}</span>
              <time dateTime={m.createdAt.toISOString()} title={formatDateTimeIST(m.createdAt)} className="whitespace-nowrap text-[12.5px] text-ink-mute">
                · {relativeTime(m.createdAt)}
              </time>
            </li>
          );
        const q = replyQuote(m, all, botConfirmMessageId);
        return (
          <li key={m.id}>
            <MessageCard
              message={m}
              attachments={attachments}
              compact
              action={action?.(m)}
              quote={
                q && (
                  <p className="flex min-w-0 items-center gap-1 text-[12.5px] text-ink-mute">
                    <CornerDownRight className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">
                      replying to <span className="font-medium text-ink-soft">{q.name}</span>: {q.snippet}
                    </span>
                  </p>
                )
              }
            />
          </li>
        );
      })}
    </ol>
  );
}
