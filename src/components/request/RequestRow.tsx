import Link from "next/link";
import type { ReactNode } from "react";
import { MessageCircle, Paperclip } from "lucide-react";
import { CLOSED, TZ } from "@/lib/constants";
import { formatDateTimeIST, istDayKey } from "@/lib/format";
import type { Priority } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { ListItem } from "@/services/requests";
import { PersonChip } from "./PersonChip";
import { StatusPill } from "./StatusPill";

const dayMonth = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short" });

/** "2 days overdue", "Overdue" (earlier today), "Due today", "Due tomorrow", "Due in 3 days", "Due 21 Oct". IST days. */
export function relativeDue(due: Date | null, now: Date = new Date()): { text: string; overdue: boolean } | null {
  if (!due) return null;
  const days = Math.round((Date.parse(istDayKey(due)) - Date.parse(istDayKey(now))) / 86400_000);
  if (days < 0) return { text: `${-days} day${days === -1 ? "" : "s"} overdue`, overdue: true };
  if (due.getTime() < now.getTime()) return { text: "Overdue", overdue: true };
  if (days === 0) return { text: "Due today", overdue: false };
  if (days === 1) return { text: "Due tomorrow", overdue: false };
  if (days < 7) return { text: `Due in ${days} days`, overdue: false };
  return { text: `Due ${dayMonth.format(due)}`, overdue: false };
}

/** 3px left border: urgent red, high amber, normal faint blue, low none. */
const EDGE: Record<Priority, string> = {
  urgent: "border-l-danger",
  high: "border-l-marigold",
  normal: "border-l-blue/25",
  low: "border-l-transparent",
};

/** Buckets whose header already says the status (so the row doesn't repeat it) and where a due date is noise. */
const SAYS_STATUS: Record<string, string> = { waiting: "waiting", done: "done", recently_done: "done" };
const NO_DUE = new Set(["waiting", "done", "recently_done"]);

const Dot = () => <span aria-hidden className="text-ink-mute/60">·</span>;

/**
 * One request, two lines. Line 1: the title (the whole row opens /r/<id>). Line 2: small metadata that skips what the
 * `bucket` header already says: the other person, status/custom label, relative due, priority (if not normal),
 * reply/attachment counts, and the group chat name last and dimmest. Done rows show "✅ <result>" instead.
 */
export function RequestRow({
  item,
  meId,
  check,
  now,
  bucket,
}: {
  item: ListItem;
  meId: number;
  check?: ReactNode;
  now?: Date;
  /** the group this row sits in (InboxBucket | RaisedBucket); omit in plain lists */
  bucket?: string;
}) {
  const toMe = item.assigneeId === meId;
  const other = toMe ? item.requester : item.assignee;
  const closed = CLOSED.includes(item.status);
  const due = closed || (bucket && NO_DUE.has(bucket)) ? null : relativeDue(item.dueAt, now);
  // line 2 stays one line: the result snippet and chat name shrink first
  // "Open" is the default and never worth a pill; a custom label is information, so it always shows
  const showStatus = !!item.customStatus || (item.status !== "open" && SAYS_STATUS[bucket ?? ""] !== item.status);
  return (
    <li className={cn("relative flex gap-3 border-l-[3px] py-3 pr-3 pl-3 transition-colors hover:bg-sand/60", EDGE[item.priority])}>
      {check && <div className="relative z-10 pt-0.5">{check}</div>}
      <div className="min-w-0 flex-1">
        <Link
          href={`/r/${item.id}`}
          className={cn(
            "line-clamp-2 min-w-0 text-[16px] font-semibold leading-snug after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring",
            closed && "text-ink-soft",
          )}
        >
          {item.title}
        </Link>
        <div className="mt-1 flex min-w-0 items-center gap-x-1.5 overflow-hidden whitespace-nowrap text-[13px] text-ink-soft [&>*]:shrink-0">
          <span className="max-w-[45%] truncate">
            {item.requesterId === item.assigneeId ? (
              "note to self"
            ) : (
              <>
                {toMe ? "from " : "to "}
                <PersonChip person={other} className="relative z-10" />
              </>
            )}
          </span>
          {closed ? (
            <>
              <Dot />
              <span className="min-w-0 !shrink truncate">
                {item.status === "declined" ? "✖️ Declined" : "✅"}
                {item.resultNote ? ` ${item.resultNote}` : item.status === "done" ? " Done" : ""}
              </span>
            </>
          ) : (
            <>
              {showStatus && <StatusPill status={item.status} customStatus={item.customStatus} className={item.customStatus ? "min-w-0 !shrink" : undefined} />}
              {due && item.dueAt && (
                <time
                  dateTime={item.dueAt.toISOString()}
                  title={formatDateTimeIST(item.dueAt)}
                  className={cn("whitespace-nowrap", due.overdue && "font-medium text-danger")}
                >
                  <Dot /> {due.text}
                </time>
              )}
            </>
          )}
          {item.priority !== "normal" && (
            <span
              className={cn(
                "pill px-1.5 text-[11.5px] font-semibold uppercase leading-5 tracking-wide",
                item.priority === "urgent" ? "bg-danger-tint text-danger" : item.priority === "high" ? "bg-marigold-tint text-ink" : "bg-sand text-ink-mute",
              )}
            >
              {item.priority}
            </span>
          )}
          {item.attachmentCount > 0 && (
            <span className="inline-flex items-center gap-0.5 text-ink-mute" title={`${item.attachmentCount} attachment(s)`}>
              <Paperclip className="size-3.5" aria-hidden />
              <span className="sr-only">attachments:</span>
              {item.attachmentCount}
            </span>
          )}
          {!closed && item.threadCount > 0 && (
            <span className="inline-flex items-center gap-0.5 text-ink-mute" title={`${item.threadCount} thread repl${item.threadCount === 1 ? "y" : "ies"}`}>
              <MessageCircle className="size-3.5" aria-hidden />
              <span className="sr-only">replies:</span>
              {item.threadCount}
            </span>
          )}
          {item.chatTitle && <span className="min-w-0 !shrink-[20] truncate text-[12px] text-ink-mute/80">{item.chatTitle}</span>}
        </div>
      </div>
    </li>
  );
}
