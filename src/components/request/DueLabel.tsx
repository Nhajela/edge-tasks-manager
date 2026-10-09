import { dueLabel, formatDateTimeIST } from "@/lib/format";
import { cn } from "@/lib/utils";

/** "due Fri" / "overdue 2d" (red). Renders nothing without a due date. */
export function DueLabel({ dueAt, now, className }: { dueAt: Date | null; now?: Date; className?: string }) {
  const label = dueLabel(dueAt, now);
  if (!label || !dueAt) return null;
  return (
    <time
      dateTime={dueAt.toISOString()}
      title={formatDateTimeIST(dueAt)}
      className={cn("whitespace-nowrap text-[13px]", label.overdue ? "font-medium text-danger" : "text-ink-soft", className)}
    >
      {label.text}
    </time>
  );
}
