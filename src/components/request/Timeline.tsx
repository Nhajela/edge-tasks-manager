import { formatDateTimeIST, relativeTime } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/constants";
import type { AuditEntry, Status } from "@/lib/types";

/** One line per audit row; comments get their text as a bubble. */
function describe(e: AuditEntry): string {
  const d = (e.data ?? {}) as Record<string, unknown>;
  switch (e.action) {
    case "request.create":
      return "raised this request";
    case "request.status":
      return typeof d.to === "string" && d.to in STATUS_LABEL
        ? `set status to ${STATUS_LABEL[d.to as Status]}${d.customStatus ? ` (“${d.customStatus}”)` : ""}${d.note ? `: ${d.note}` : ""}`
        : `set status to ${e.summary}`;
    case "request.comment":
      return d.notify ? "commented (told them on Telegram)" : "commented";
    case "request.title":
      return `renamed it “${e.summary}”`;
    case "request.priority":
      return `set ${e.summary.toLowerCase()}`;
    case "request.due":
      return typeof d.to === "string" ? `set due ${formatDateTimeIST(new Date(d.to))}` : "removed the due date";
    case "request.append":
      return "added to the request";
    case "request.thread":
      return "replied in the thread";
    case "request.bot_confirm":
      return "posted the bot confirmation in Telegram";
    default:
      return e.summary || e.action;
  }
}

export function Timeline({ entries }: { entries: AuditEntry[] }) {
  if (!entries.length) return <p className="text-[14px] text-ink-mute">Nothing yet.</p>;
  return (
    <ol className="flex flex-col">
      {entries.map((e) => (
        <li key={e.id} className="relative border-l border-line pb-3.5 pl-4 last:pb-0">
          <span aria-hidden className="absolute -left-[4.5px] top-1.5 size-2 rounded-full bg-line" />
          <p className="text-[14px] leading-5 text-ink-soft">
            <span className="font-medium text-ink">{e.actorLabel}</span> {describe(e)}{" "}
            <time dateTime={e.at.toISOString()} title={formatDateTimeIST(e.at)} className="whitespace-nowrap text-[12.5px] text-ink-mute">
              · {relativeTime(e.at)}
            </time>
          </p>
          {e.action === "request.comment" && (
            <p className="mt-1.5 w-fit max-w-full whitespace-pre-wrap break-words rounded-2xl rounded-tl-md bg-sand px-3 py-2 text-[15px] leading-6 text-ink">
              {e.summary}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
