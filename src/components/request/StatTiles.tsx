import Link from "next/link";
import { CLOSED } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { RAISED_TILES, type RaisedTileKey, type Tile } from "@/services/grouping";
import type { ListItem } from "@/services/requests";

/** ?tile=overdue etc.; anything else is no filter. */
export function parseTile(v: string | string[] | undefined): RaisedTileKey | null {
  return RAISED_TILES.find((k) => k === v) ?? null;
}

/** Which rows a tapped tile keeps. ponytail: mirrors grouping.ts tile counts by hand; if they drift, export a predicate from grouping. */
export function tileMatches(key: RaisedTileKey, item: ListItem, now: Date): boolean {
  switch (key) {
    case "overdue":
      return !CLOSED.includes(item.status) && !!item.dueAt && +item.dueAt < +now;
    case "done_this_week":
      return item.status === "done" && !!item.doneAt && +now - +item.doneAt <= 7 * 86400_000;
    default:
      return item.status === key;
  }
}

/** Raised stat tiles in a fixed order; only Overdue goes red (and only when > 0). Tapping one filters; tapping it again clears. */
export function StatTiles({ tiles, base, current }: { tiles: Tile[]; base: string; current: RaisedTileKey | null }) {
  return (
    <nav aria-label="Filter" className="grid grid-cols-5 gap-1.5 sm:gap-2">
      {tiles.map((t) => {
        const on = current === t.key;
        const red = t.danger && t.count > 0;
        return (
          <Link
            key={t.key}
            href={on ? base : `${base}?tile=${t.key}`}
            aria-current={on ? "true" : undefined}
            className={cn(
              "flex min-h-16 flex-col justify-between rounded-[12px] border px-2 py-2 transition-colors sm:px-3",
              on ? "border-ink bg-ink text-paper" : red ? "border-danger/30 bg-danger-tint text-danger" : "border-line-soft bg-paper hover:bg-sand",
            )}
          >
            <span className="text-[22px] font-bold leading-none tabular-nums">{t.count}</span>
            <span className={cn("text-[11.5px] font-medium leading-tight sm:text-[13px]", on ? "text-paper/80" : red ? "" : "text-ink-soft")}>{t.title}</span>
          </Link>
        );
      })}
    </nav>
  );
}
