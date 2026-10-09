/**
 * Verb-bucket grouping for "To me" and "I asked" (SPEC "Grouping (never mix directions)", modelled on kx-tess
 * src/services/personal-dashboard.ts). Pure: no DB, no actor; feed it listInbox / listRaised items (status "all",
 * closedSince = 14 days ago) and `now`. Days are IST (Asia/Kolkata) calendar days.
 *
 * Shared rules: buckets in the fixed order below (never by count); empty buckets are omitted; inside every bucket sort by
 * priority (urgent→low), then due ascending (undated last), then oldest first.
 */
import { PRIORITIES } from "@/lib/constants";
import { istDayKey } from "@/lib/format";
import type { Person } from "@/lib/types";
import type { ListItem } from "./requests";

/** To me: New (open, assignee_seen_at null) · Act (open/doing, due ≤ tomorrow or undated) · Upcoming (due after tomorrow) · Waiting · Done (closed ≤ 14 days, collapsed). */
export const INBOX_BUCKETS = ["new", "act", "upcoming", "waiting", "done"] as const;
export type InboxBucket = (typeof INBOX_BUCKETS)[number];

/** I asked: Overdue · Active · Waiting · Recently done (collapsed). */
export const RAISED_BUCKETS = ["overdue", "active", "waiting", "recently_done"] as const;
export type RaisedBucket = (typeof RAISED_BUCKETS)[number];

/** I asked, stat tiles in this order; only Overdue is red. Tapping one filters the list. */
export const RAISED_TILES = ["overdue", "open", "in_progress", "waiting", "done_this_week"] as const;
export type RaisedTileKey = (typeof RAISED_TILES)[number];

export type Group<K extends string> = {
  key: K;
  /** header text, e.g. "Act", "Recently done" */
  title: string;
  count: number;
  /** sorted per the shared rules */
  items: ListItem[];
  collapsedByDefault: boolean;
};

export type Tile = { key: RaisedTileKey; title: string; count: number; danger: boolean };

/** People strip on /raised: who has your requests. Overdue/waiting people first; the rest are "on track" behind "Show N more". */
export type PersonSummary = { person: Person; open: number; overdue: number; waiting: number; onTrack: boolean };

export type Grouped<K extends string> = { groups: Group<K>[]; tiles?: Tile[]; people?: PersonSummary[] };

const DAY = 86400_000;
const DONE_WINDOW_DAYS = 14;
const ms = (d: Date | string | null) => (d ? new Date(d).getTime() : Infinity);
/** Whole IST calendar days from `now` to `d` (negative = past). */
const istDays = (d: Date | string, now: Date) => Math.round((Date.parse(istDayKey(new Date(d))) - Date.parse(istDayKey(now))) / DAY);
const isClosed = (i: ListItem) => i.status === "done" || i.status === "declined";
const recentlyClosed = (i: ListItem, now: Date) => isClosed(i) && (!i.doneAt || ms(i.doneAt) > now.getTime() - DONE_WINDOW_DAYS * DAY);
/** Same instant test as dueLabel(), so the "Overdue" bucket matches the red "overdue" row label. */
const isOverdue = (i: ListItem, now: Date) => !isClosed(i) && ms(i.dueAt) < now.getTime();

/** priority urgent→low, then due ascending (undated last), then oldest, then id. */
const byShared = (a: ListItem, b: ListItem) =>
  PRIORITIES.indexOf(b.priority) - PRIORITIES.indexOf(a.priority) ||
  ms(a.dueAt) - ms(b.dueAt) ||
  ms(a.createdAt) - ms(b.createdAt) ||
  a.id - b.id;

function build<K extends string>(
  order: readonly K[],
  titles: Record<K, string>,
  collapsed: K,
  items: ListItem[],
  bucketOf: (i: ListItem) => K | null,
): Group<K>[] {
  return order
    .map((key) => {
      const rows = items.filter((i) => bucketOf(i) === key).sort(byShared);
      return { key, title: titles[key], count: rows.length, items: rows, collapsedByDefault: key === collapsed };
    })
    .filter((g) => g.count > 0);
}

const INBOX_TITLES: Record<InboxBucket, string> = { new: "New", act: "Act", upcoming: "Upcoming", waiting: "Waiting", done: "Done" };

/**
 * /inbox (To me) buckets.
 * @param items listInbox items (the actor is the assignee of every one)
 * @param now the clock, injected for tests
 */
export function groupInbox(items: ListItem[], now: Date): Grouped<InboxBucket> {
  const bucketOf = (i: ListItem): InboxBucket | null => {
    if (isClosed(i)) return recentlyClosed(i, now) ? "done" : null;
    if (i.status === "waiting") return "waiting";
    if (i.status === "open" && !i.assigneeSeenAt) return "new";
    return i.dueAt && istDays(i.dueAt, now) > 1 ? "upcoming" : "act";
  };
  return { groups: build(INBOX_BUCKETS, INBOX_TITLES, "done", items, bucketOf) };
}

const RAISED_TITLES: Record<RaisedBucket, string> = { overdue: "Overdue", active: "Active", waiting: "Waiting", recently_done: "Recently done" };
const TILE_TITLES: Record<RaisedTileKey, string> = {
  overdue: "Overdue",
  open: "Open",
  in_progress: "In progress",
  waiting: "Waiting",
  done_this_week: "Done this week",
};

/**
 * /raised (I asked) buckets, plus `tiles` (always all five, fixed order) and `people` (assignees of open items).
 * @param items listRaised items (the actor is the requester of every one)
 * @param now the clock, injected for tests
 */
export function groupRaised(items: ListItem[], now: Date): Required<Grouped<RaisedBucket>> {
  const bucketOf = (i: ListItem): RaisedBucket | null => {
    if (isClosed(i)) return recentlyClosed(i, now) ? "recently_done" : null;
    if (isOverdue(i, now)) return "overdue";
    return i.status === "waiting" ? "waiting" : "active";
  };
  // "this week" = today and the 6 IST days before it (rolling, not Monday-based)
  const tileTest: Record<RaisedTileKey, (i: ListItem) => boolean> = {
    overdue: (i) => isOverdue(i, now),
    open: (i) => i.status === "open",
    in_progress: (i) => i.status === "in_progress",
    waiting: (i) => i.status === "waiting",
    done_this_week: (i) => i.status === "done" && !!i.doneAt && istDays(i.doneAt, now) >= -6,
  };
  const tiles = RAISED_TILES.map((key) => ({
    key,
    title: TILE_TITLES[key],
    count: items.filter(tileTest[key]).length,
    danger: key === "overdue",
  }));

  const byPerson = new Map<number, PersonSummary>();
  for (const i of items) {
    if (isClosed(i)) continue;
    const p = byPerson.get(i.assigneeId) ?? { person: i.assignee, open: 0, overdue: 0, waiting: 0, onTrack: true };
    p.open++;
    if (isOverdue(i, now)) p.overdue++;
    if (i.status === "waiting") p.waiting++;
    p.onTrack = !p.overdue && !p.waiting;
    byPerson.set(i.assigneeId, p);
  }
  const name = (p: PersonSummary) => p.person.username ?? p.person.firstName ?? "";
  const people = [...byPerson.values()].sort(
    (a, b) =>
      Number(a.onTrack) - Number(b.onTrack) ||
      b.overdue - a.overdue ||
      b.waiting - a.waiting ||
      b.open - a.open ||
      name(a).localeCompare(name(b)),
  );

  return { groups: build(RAISED_BUCKETS, RAISED_TITLES, "recently_done", items, bucketOf), tiles, people };
}
