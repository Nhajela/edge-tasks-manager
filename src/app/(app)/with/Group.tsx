import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

/**
 * ponytail: minimal stand-in for src/components/request/Group.tsx (built in r2/web-inbox-raised, not on this base).
 * Native <details>: caret + title + count chip, collapsible without JS. No "Show N more" yet; swap to the shared
 * component when it lands.
 */
export function Group({
  title,
  count,
  collapsedByDefault,
  meta,
  children,
}: {
  title: ReactNode;
  count: number;
  collapsedByDefault?: boolean;
  /** extra header text after the count, e.g. "2 overdue" */
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <details open={!collapsedByDefault} className="group/g border-t border-line-soft pt-3 first:border-t-0 first:pt-0">
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-[15px] font-semibold [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 text-ink-mute transition-transform group-open/g:rotate-90" aria-hidden />
        <span className="min-w-0 truncate">{title}</span>
        <span className="tnum pill bg-sand px-2 text-[13px] font-medium text-ink-soft">{count}</span>
        {meta}
      </summary>
      <div className="mt-2 pl-6">{children}</div>
    </details>
  );
}
