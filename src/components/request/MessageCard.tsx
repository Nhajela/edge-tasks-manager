import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { Initial } from "@/components/bits";
import { signFileId } from "@/lib/files";
import { formatDateTimeIST, relativeTime } from "@/lib/format";
import { displayName } from "@/lib/names";
import type { Attachment } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { DetailMessage } from "@/services/requests";

/** Relative and signed, so it works on any host (dev ports, previews). */
const fileHref = (id: number) => `/api/files/${id}?sig=${signFileId(id)}`;

/** One Telegram message: author, time, text, photos/files, and "Open in Telegram". */
export function MessageCard({
  message: m,
  attachments,
  quote,
  compact,
}: {
  message: DetailMessage;
  attachments: Attachment[];
  quote?: ReactNode;
  compact?: boolean;
}) {
  const files = attachments.filter((a) => a.chatId === m.chatId && a.messageId === m.messageId);
  const name = displayName(m.from);
  return (
    <article className={cn("flex gap-2.5", !compact && "rounded-[var(--radius-card)] border border-line-soft bg-paper p-3.5")}>
      <Initial name={m.from?.username || m.from?.firstName || "?"} className={compact ? "size-8 text-[13px]" : undefined} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {quote}
        <div className={cn("flex min-w-0 flex-col gap-1", compact && "rounded-2xl rounded-tl-md bg-sand px-3 py-2")}>
          <header className="flex min-w-0 items-baseline gap-2 text-[13px]">
            <span className="truncate font-semibold text-ink">{name}</span>
            <time dateTime={m.createdAt.toISOString()} title={formatDateTimeIST(m.createdAt)} className="shrink-0 text-ink-mute">
              {relativeTime(m.createdAt)}
            </time>
          </header>
          {m.text && <p className="whitespace-pre-wrap break-words text-[15px] leading-6 text-ink">{m.text}</p>}
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {files.map((f) =>
                f.kind === "photo" ? (
                  <a key={f.id} href={fileHref(f.id)} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-line-soft bg-sand">
                    {/* eslint-disable-next-line @next/next/no-img-element -- signed proxy URL, not optimisable */}
                    <img src={fileHref(f.id)} alt={`Photo from ${name}`} loading="lazy" className="h-32 w-auto max-w-full object-cover sm:h-40" />
                  </a>
                ) : (
                  <a key={f.id} href={fileHref(f.id)} target="_blank" rel="noreferrer" className="pill bg-sand px-3 py-1.5 text-[13.5px] font-medium underline-offset-2 hover:underline">
                    {f.fileName || "File"}
                  </a>
                ),
              )}
            </div>
          )}
        </div>
        {m.link && (
          <a href={m.link} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 py-1 text-[13px] font-medium text-teal-deep underline-offset-2 hover:underline">
            Open in Telegram <ExternalLink className="size-3.5" aria-hidden />
          </a>
        )}
      </div>
    </article>
  );
}
