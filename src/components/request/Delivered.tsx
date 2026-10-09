import { ExternalLink } from "lucide-react";
import { formatDateTimeIST, relativeTime } from "@/lib/format";
import { displayName } from "@/lib/names";
import type { Attachment, AuditEntry, Person, Request } from "@/lib/types";
import type { DetailMessage } from "@/services/requests";
import { fileHref } from "./MessageCard";

type Entry = Pick<AuditEntry, "action" | "actorLabel" | "data">;
const data = (e: Entry) => (e.data ?? {}) as { to?: string; result?: unknown; onBehalfOf?: number };

/** Who recorded the current result (the last done-with-result or ⭐), and who closed it when not the assignee. */
export function deliveredInfo(timeline: Entry[]): { by: string; closedBy: string | null } {
  const rev = [...timeline].reverse();
  const by = rev.find((e) => e.action === "request.deliverable" || (e.action === "request.status" && data(e).result));
  const done = rev.find((e) => e.action === "request.status" && data(e).to === "done");
  return { by: by?.actorLabel ?? "someone", closedBy: done && data(done).onBehalfOf != null ? done.actorLabel : null };
}

/** The highlighted "✅ Delivered" card at the top of a done request: note, media, who and when, Telegram link. */
export function Delivered({
  request: r,
  message,
  attachments,
  timeline,
  assignee,
}: {
  request: Request;
  message: DetailMessage | null;
  attachments: Attachment[];
  timeline: AuditEntry[];
  assignee: Person;
}) {
  if (r.status !== "done" || (!r.resultNote && !message)) return null;
  const { by, closedBy } = deliveredInfo(timeline);
  const files = message ? attachments.filter((a) => a.chatId === message.chatId && a.messageId === message.messageId) : [];
  const at = r.resultAt ?? r.doneAt;
  return (
    <section aria-label="Delivered" className="flex flex-col gap-2.5 rounded-[var(--radius-card)] border-2 border-teal bg-teal-tint p-3.5">
      <h2 className="text-[15px] font-semibold text-teal-deep">✅ Delivered</h2>
      {r.resultNote && <p className="whitespace-pre-wrap break-words text-[15.5px] leading-6 text-ink">{r.resultNote}</p>}
      {message?.text && message.text !== r.resultNote && (
        <blockquote className="whitespace-pre-wrap break-words border-l-2 border-teal pl-3 text-[14.5px] leading-6 text-ink-soft">
          <span className="font-medium text-ink">{displayName(message.from)}:</span> {message.text}
        </blockquote>
      )}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((f) =>
            f.kind === "photo" ? (
              <a key={f.id} href={fileHref(f.id)} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-line-soft bg-paper">
                {/* eslint-disable-next-line @next/next/no-img-element -- signed proxy URL, not optimisable */}
                <img src={fileHref(f.id)} alt="Delivered photo (tap to open)" loading="lazy" className="h-40 w-auto max-w-full object-cover sm:h-52" />
              </a>
            ) : (
              <a key={f.id} href={fileHref(f.id)} target="_blank" rel="noreferrer" className="pill bg-paper px-3 py-1.5 text-[13.5px] font-medium underline-offset-2 hover:underline">
                {f.fileName || "File"}
              </a>
            ),
          )}
        </div>
      )}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-soft">
        <span>
          by <span className="font-medium text-ink">{by}</span>
          {at && (
            <>
              {" · "}
              <time dateTime={at.toISOString()} title={formatDateTimeIST(at)}>
                {relativeTime(at)}
              </time>
            </>
          )}
        </span>
        {message?.link && (
          <a href={message.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 py-1 font-medium text-teal-deep underline-offset-2 hover:underline">
            Open in Telegram <ExternalLink className="size-3.5" aria-hidden />
          </a>
        )}
      </p>
      {closedBy && (
        <p className="text-[13px] text-ink-soft">
          Closed by {closedBy} on behalf of {displayName(assignee)}
        </p>
      )}
    </section>
  );
}
