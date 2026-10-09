"use client";

import { type ReactNode, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const PAGE = 5;

/**
 * A bucket (SPEC "Grouping"): header button = caret + title + count chip, collapsible; then the first 5 rows and
 * "Show N more" (+5). The caller renders nothing for an empty bucket.
 */
export function Group({
  title,
  count,
  collapsedByDefault,
  rows,
  meta,
}: {
  title: string;
  count: number;
  collapsedByDefault: boolean;
  rows: ReactNode[];
  /** extra header text after the count, e.g. "2 overdue" */
  meta?: ReactNode;
}) {
  const [open, setOpen] = useState(!collapsedByDefault);
  const [shown, setShown] = useState(PAGE);
  const more = Math.min(PAGE, rows.length - shown);
  return (
    <section aria-label={`${title} (${count})`} className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="-mx-1 flex min-h-11 items-center gap-2 rounded-lg px-1 text-left hover:bg-sand/60"
      >
        <ChevronRight aria-hidden className={cn("size-4 text-ink-mute transition-transform", open && "rotate-90")} />
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <span className="pill bg-sand px-2 text-[12.5px] font-medium leading-5 tabular-nums text-ink-soft">{count}</span>
        {meta}
      </button>
      {open && (
        <div className="pl-6">
          <ul className="divide-y divide-line-soft">{rows.slice(0, shown)}</ul>
          {more > 0 && (
            <button
              type="button"
              onClick={() => setShown((n) => n + PAGE)}
              className="mt-1 min-h-10 w-full rounded-lg text-[13.5px] font-medium text-ink-soft hover:bg-sand/60 hover:text-ink"
            >
              Show {more} more
            </button>
          )}
        </div>
      )}
    </section>
  );
}
