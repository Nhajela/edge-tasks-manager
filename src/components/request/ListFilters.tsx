import Link from "next/link";
import { LinkHint } from "@/components/feedback";
import { cn } from "@/lib/utils";

export type ListStatus = "open" | "done" | "all";

/** ?status=done|all; anything else (or missing) is the default, open. */
export function parseListStatus(v: string | string[] | undefined): ListStatus {
  return v === "done" || v === "all" ? v : "open";
}

const Count = ({ n }: { n: number }) => <span className="ml-1.5 tabular-nums text-ink-mute">{n}</span>;

/** "To me 3 | I asked 5": the two list pages, with open counts. */
export function ListTabs({ current, inboxOpen, raisedOpen }: { current: "inbox" | "raised"; inboxOpen: number; raisedOpen: number }) {
  const tab = (key: "inbox" | "raised", label: string, n: number) => (
    <Link
      href={`/${key}`}
      aria-current={current === key ? "page" : undefined}
      className={cn(
        "flex min-h-11 flex-1 items-center justify-center rounded-[10px] px-3 text-[15px] font-semibold transition-colors",
        current === key ? "bg-paper text-ink shadow-sm" : "text-ink-soft hover:text-ink",
      )}
    >
      {label}
      <Count n={n} />
      <LinkHint />
    </Link>
  );
  return (
    <nav aria-label="Lists" className="flex gap-1 rounded-[14px] bg-sand p-1">
      {tab("inbox", "To me", inboxOpen)}
      {tab("raised", "I asked", raisedOpen)}
    </nav>
  );
}

/** Open · Done · All chips, as links that set ?status=. */
export function StatusChips({ base, current, counts }: { base: string; current: ListStatus; counts: Record<ListStatus, number> }) {
  const chips: [ListStatus, string][] = [
    ["open", "Open"],
    ["done", "Done"],
    ["all", "All"],
  ];
  return (
    <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
      {chips.map(([key, label]) => (
        <Link
          key={key}
          href={key === "open" ? base : `${base}?status=${key}`}
          aria-current={current === key ? "page" : undefined}
          className={cn(
            "pill inline-flex min-h-9 items-center border px-3.5 text-[14px] font-medium transition-colors",
            current === key ? "border-ink bg-ink text-paper [&_span]:text-paper/70" : "border-line text-ink-soft hover:bg-sand hover:text-ink",
          )}
        >
          {label}
          <Count n={counts[key]} />
          <LinkHint />
        </Link>
      ))}
    </nav>
  );
}
