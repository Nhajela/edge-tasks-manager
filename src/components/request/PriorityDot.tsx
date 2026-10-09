import { cn } from "@/lib/utils";
import type { Priority } from "@/lib/types";

const COLOR: Record<Priority, string> = {
  low: "bg-line",
  normal: "bg-ink-mute/40",
  high: "bg-marigold",
  urgent: "bg-danger",
};

/** Small coloured dot; screen readers get the priority name. */
export function PriorityDot({ priority, className }: { priority: Priority; className?: string }) {
  return (
    <span
      role="img"
      aria-label={`${priority} priority`}
      title={`${priority} priority`}
      className={cn("inline-block size-2.5 shrink-0 rounded-full", COLOR[priority], className)}
    />
  );
}
