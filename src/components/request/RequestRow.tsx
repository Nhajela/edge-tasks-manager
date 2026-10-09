import Link from "next/link";
import type { ReactNode } from "react";
import { MessageCircle, Paperclip } from "lucide-react";
import { CLOSED } from "@/lib/constants";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ListItem } from "@/services/requests";
import { DueLabel } from "./DueLabel";
import { PersonChip } from "./PersonChip";
import { PriorityDot } from "./PriorityDot";
import { StatusPill } from "./StatusPill";

/**
 * One request in a list. The whole row opens /r/<id> (stretched title link); the person chip and the optional
 * `check` slot sit above it so they stay clickable. Shows the *other* person: "from" when it's assigned to me.
 */
export function RequestRow({ item, meId, check, now }: { item: ListItem; meId: number; check?: ReactNode; now?: Date }) {
  const toMe = item.assigneeId === meId;
  const other = toMe ? item.requester : item.assignee;
  const closed = CLOSED.includes(item.status);
  return (
    <li className="relative flex gap-3 px-4 py-3.5 transition-colors hover:bg-sand/60">
      {check && <div className="relative z-10 pt-0.5">{check}</div>}
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <PriorityDot priority={item.priority} className="mt-[7px]" />
          <Link
            href={`/r/${item.id}`}
            className={cn(
              "line-clamp-2 min-w-0 text-[16px] font-semibold leading-snug after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring",
              closed && "text-ink-mute line-through decoration-ink-mute/50",
            )}
          >
            {item.title}
          </Link>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-[18px] text-[13px] text-ink-soft">
          <span className="min-w-0 truncate">
            {item.requesterId === item.assigneeId ? "note to self" : toMe ? "from " : "to "}
            {item.requesterId !== item.assigneeId && <PersonChip person={other} className="relative z-10" />}
          </span>
          <StatusPill status={item.status} customStatus={item.customStatus} />
          {!closed && <DueLabel dueAt={item.dueAt} now={now} />}
          <span className="whitespace-nowrap text-ink-mute">
            #{item.id} · {relativeTime(item.createdAt, now)}
          </span>
          {item.attachmentCount > 0 && (
            <span className="inline-flex items-center gap-0.5 text-ink-mute" title={`${item.attachmentCount} attachment(s)`}>
              <Paperclip className="size-3.5" aria-hidden />
              <span className="sr-only">attachments:</span>
              {item.attachmentCount}
            </span>
          )}
          {item.threadCount > 0 && (
            <span className="inline-flex items-center gap-0.5 text-ink-mute" title={`${item.threadCount} thread repl${item.threadCount === 1 ? "y" : "ies"}`}>
              <MessageCircle className="size-3.5" aria-hidden />
              <span className="sr-only">replies:</span>
              {item.threadCount}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}
