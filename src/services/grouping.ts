/**
 * Verb-bucket grouping for "To me" and "I asked" (SPEC "Grouping (never mix directions)", modelled on kx-tess
 * src/services/personal-dashboard.ts). Pure: no DB, no actor; feed it listInbox / listRaised items (status "all",
 * closedSince = 14 days ago) and `now`. Days are IST (Asia/Kolkata) calendar days.
 *
 * Shared rules: buckets in the fixed order below (never by count); empty buckets are omitted; inside every bucket sort by
 * priority (urgent→low), then due ascending (undated last), then oldest first.
 */
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

/**
 * /inbox (To me) buckets.
 * @param items listInbox items (the actor is the assignee of every one)
 * @param now the clock, injected for tests
 */
export function groupInbox(items: ListItem[], now: Date): Grouped<InboxBucket> {
  void items;
  void now;
  throw new Error("not implemented");
}

/**
 * /raised (I asked) buckets, plus `tiles` (always all five, fixed order) and `people` (assignees of open items).
 * @param items listRaised items (the actor is the requester of every one)
 * @param now the clock, injected for tests
 */
export function groupRaised(items: ListItem[], now: Date): Required<Grouped<RaisedBucket>> {
  void items;
  void now;
  throw new Error("not implemented");
}
