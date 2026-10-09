import { describe, expect, it } from "vitest";
import type { Person } from "@/lib/types";
import type { ListItem } from "../requests";
import { groupInbox, groupRaised, INBOX_BUCKETS, RAISED_BUCKETS, RAISED_TILES } from "../grouping";

// 2026-10-15 10:00 IST
const now = new Date("2026-10-15T04:30:00Z");
const h = (n: number) => new Date(now.getTime() + n * 3600_000);
const ist = (s: string) => new Date(`${s}+05:30`);
const person = (id: number, username: string) => ({ id, username, firstName: username }) as Person;
const me = person(9100000001, "me");
const bob = person(9100000002, "bob");
const cat = person(9100000003, "cat");
const dan = person(9100000004, "dan");
let seq = 0;
const row = (p: Partial<ListItem>) =>
  ({
    id: ++seq,
    status: "open",
    priority: "normal",
    dueAt: null,
    doneAt: null,
    assigneeSeenAt: h(-1),
    createdAt: h(-48),
    updatedAt: h(-48),
    requester: me,
    assignee: me,
    requesterId: me.id,
    assigneeId: me.id,
    ...p,
  }) as ListItem;
const ids = (items: ListItem[]) => items.map((i) => i.id);
const shape = (g: { groups: { key: string; items: ListItem[] }[] }) => g.groups.map((x) => [x.key, ids(x.items)]);

describe("groupInbox", () => {
  it("exports the fixed bucket orders", () => {
    expect(INBOX_BUCKETS).toEqual(["new", "act", "upcoming", "waiting", "done"]);
    expect(RAISED_BUCKETS).toEqual(["overdue", "active", "waiting", "recently_done"]);
    expect(RAISED_TILES).toEqual(["overdue", "open", "in_progress", "waiting", "done_this_week"]);
  });

  it("empty input gives no groups", () => {
    expect(groupInbox([], now).groups).toEqual([]);
  });

  it("puts every status in its bucket, in fixed order, never by count", () => {
    const fresh = row({ assigneeSeenAt: null });
    const act = row({});
    const up = row({ dueAt: h(24 * 5) });
    const w1 = row({ status: "waiting" });
    const w2 = row({ status: "waiting" });
    const w3 = row({ status: "waiting" });
    const d = row({ status: "done", doneAt: h(-2) });
    const g = groupInbox([d, w1, up, w2, act, w3, fresh], now);
    expect(g.groups.map((x) => x.key)).toEqual(["new", "act", "upcoming", "waiting", "done"]);
    expect(g.groups.map((x) => x.title)).toEqual(["New", "Act", "Upcoming", "Waiting", "Done"]);
    expect(g.groups.map((x) => x.count)).toEqual([1, 1, 1, 3, 1]);
    expect(g.groups.map((x) => x.collapsedByDefault)).toEqual([false, false, false, false, true]);
  });

  it("omits empty buckets", () => {
    expect(shape(groupInbox([row({ status: "waiting" })], now))).toEqual([["waiting", [seq]]]);
  });

  it("New is open + never seen, even when overdue", () => {
    const a = row({ assigneeSeenAt: null, dueAt: h(-30) });
    expect(shape(groupInbox([a], now))).toEqual([["new", [a.id]]]);
  });

  it("an unseen in_progress / waiting item is not New (they already acted on it)", () => {
    const a = row({ assigneeSeenAt: null, status: "in_progress" });
    const b = row({ assigneeSeenAt: null, status: "waiting" });
    expect(shape(groupInbox([a, b], now))).toEqual([
      ["act", [a.id]],
      ["waiting", [b.id]],
    ]);
  });

  it("Act holds overdue, today, tomorrow and undated; open and in_progress alike", () => {
    const overdue = row({ dueAt: h(-50) });
    const today = row({ dueAt: ist("2026-10-15T23:00") });
    const tomorrow = row({ dueAt: ist("2026-10-16T23:59"), status: "in_progress" });
    const undated = row({});
    const later = row({ dueAt: ist("2026-10-17T00:00") });
    expect(shape(groupInbox([later, undated, tomorrow, today, overdue], now))).toEqual([
      ["act", [overdue.id, today.id, tomorrow.id, undated.id]],
      ["upcoming", [later.id]],
    ]);
  });

  it("IST midnight: at 23:59 IST tomorrow is the next IST day, not the next UTC day", () => {
    const late = ist("2026-10-15T23:59"); // 18:29Z, same UTC day
    const d17Early = row({ dueAt: ist("2026-10-17T00:01") }); // 2026-10-16T18:31Z, UTC says "tomorrow"
    const d16Late = row({ dueAt: ist("2026-10-16T23:59") });
    expect(shape(groupInbox([d17Early, d16Late], late))).toEqual([
      ["act", [d16Late.id]],
      ["upcoming", [d17Early.id]],
    ]);
    // two minutes later the IST day rolls over and the 17th is "tomorrow"
    expect(shape(groupInbox([d17Early, d16Late], ist("2026-10-16T00:01")))).toEqual([
      ["act", [d16Late.id, d17Early.id]],
    ]);
  });

  it("IST midnight: 00:30 IST is already the next day though UTC is still the previous one", () => {
    const early = ist("2026-10-16T00:30"); // 2026-10-15T19:00Z
    const d17 = row({ dueAt: ist("2026-10-17T20:00") }); // tomorrow in IST
    expect(shape(groupInbox([d17], early))).toEqual([["act", [d17.id]]]);
  });

  it("Waiting keeps every waiting item regardless of due", () => {
    const a = row({ status: "waiting", dueAt: h(-100), customStatus: "parts" });
    const b = row({ status: "waiting", dueAt: h(200) });
    expect(shape(groupInbox([b, a], now))).toEqual([["waiting", [a.id, b.id]]]);
  });

  it("Done holds done and declined within 14 days, collapsed", () => {
    const d = row({ status: "done", doneAt: h(-24) });
    const x = row({ status: "declined", doneAt: h(-24 * 13) });
    const old = row({ status: "done", doneAt: h(-24 * 15) });
    const g = groupInbox([d, x, old], now);
    expect(shape(g)).toEqual([["done", [d.id, x.id]]]);
    expect(g.groups[0].collapsedByDefault).toBe(true);
  });

  it("sorts by priority urgent→low first", () => {
    const low = row({ priority: "low" });
    const normal = row({});
    const urgent = row({ priority: "urgent" });
    const high = row({ priority: "high" });
    expect(shape(groupInbox([low, normal, urgent, high], now))).toEqual([["act", [urgent.id, high.id, normal.id, low.id]]]);
  });

  it("then due ascending with undated last", () => {
    const none = row({});
    const later = row({ dueAt: h(20) });
    const soon = row({ dueAt: h(2) });
    expect(shape(groupInbox([none, later, soon], now))).toEqual([["act", [soon.id, later.id, none.id]]]);
  });

  it("priority beats due: an undated urgent leads a dated normal", () => {
    const dated = row({ dueAt: h(-5) });
    const urgent = row({ priority: "urgent" });
    expect(shape(groupInbox([dated, urgent], now))).toEqual([["act", [urgent.id, dated.id]]]);
  });

  it("then oldest first, then id", () => {
    const young = row({ createdAt: h(-1) });
    const old = row({ createdAt: h(-100) });
    const twinA = row({ createdAt: h(-50) });
    const twinB = row({ createdAt: h(-50) });
    expect(shape(groupInbox([young, twinB, old, twinA], now))).toEqual([["act", [old.id, twinA.id, twinB.id, young.id]]]);
  });

  it("does not mutate the input array", () => {
    const a = row({ priority: "low" });
    const b = row({ priority: "urgent" });
    const input = [a, b];
    groupInbox(input, now);
    expect(ids(input)).toEqual([a.id, b.id]);
  });

  it("accepts ISO strings for dates (JSON round-trip from the API)", () => {
    const a = JSON.parse(JSON.stringify(row({ dueAt: h(24 * 4) }))) as ListItem;
    expect(shape(groupInbox([a], now))).toEqual([["upcoming", [a.id]]]);
  });
});

describe("groupRaised", () => {
  const to = (p: Person, x: Partial<ListItem> = {}) => row({ assignee: p, assigneeId: p.id, ...x });

  it("empty input: no groups, all five tiles at zero, no people", () => {
    const g = groupRaised([], now);
    expect(g.groups).toEqual([]);
    expect(g.tiles).toEqual([
      { key: "overdue", title: "Overdue", count: 0, danger: true },
      { key: "open", title: "Open", count: 0, danger: false },
      { key: "in_progress", title: "In progress", count: 0, danger: false },
      { key: "waiting", title: "Waiting", count: 0, danger: false },
      { key: "done_this_week", title: "Done this week", count: 0, danger: false },
    ]);
    expect(g.people).toEqual([]);
  });

  it("buckets in fixed order with titles; Recently done collapsed", () => {
    const od = to(bob, { dueAt: h(-3) });
    const act = to(bob, { status: "in_progress" });
    const w = to(cat, { status: "waiting" });
    const d = to(cat, { status: "done", doneAt: h(-5) });
    const g = groupRaised([d, w, act, od], now);
    expect(shape(g)).toEqual([
      ["overdue", [od.id]],
      ["active", [act.id]],
      ["waiting", [w.id]],
      ["recently_done", [d.id]],
    ]);
    expect(g.groups.map((x) => x.title)).toEqual(["Overdue", "Active", "Waiting", "Recently done"]);
    expect(g.groups.map((x) => x.collapsedByDefault)).toEqual([false, false, false, true]);
  });

  it("Overdue takes any open, in_progress or waiting item past its due; due later today is Active", () => {
    const a = to(bob, { dueAt: h(-1) });
    const b = to(bob, { dueAt: h(-1), status: "in_progress" });
    const c = to(bob, { dueAt: h(-1), status: "waiting" });
    const today = to(bob, { dueAt: h(3) });
    const doneLate = to(bob, { dueAt: h(-10), status: "done", doneAt: h(-1) });
    expect(shape(groupRaised([a, b, c, today, doneLate], now))).toEqual([
      ["overdue", [a.id, b.id, c.id]],
      ["active", [today.id]],
      ["recently_done", [doneLate.id]],
    ]);
  });

  it("Active holds unseen items too (New is an inbox-only bucket)", () => {
    const a = to(bob, { assigneeSeenAt: null });
    expect(shape(groupRaised([a], now))).toEqual([["active", [a.id]]]);
  });

  it("Recently done drops items closed more than 14 days ago", () => {
    const d = to(bob, { status: "declined", doneAt: h(-24 * 3) });
    const old = to(bob, { status: "done", doneAt: h(-24 * 20) });
    expect(shape(groupRaised([d, old], now))).toEqual([["recently_done", [d.id]]]);
  });

  it("tiles count statuses (overlapping Overdue) and only Overdue is danger", () => {
    const items = [
      to(bob, { dueAt: h(-1) }), // open + overdue
      to(bob),
      to(bob, { status: "in_progress" }),
      to(cat, { status: "waiting", dueAt: h(-2) }), // waiting + overdue
      to(cat, { status: "done", doneAt: h(-24) }),
      to(cat, { status: "declined", doneAt: h(-24) }),
    ];
    const t = Object.fromEntries(groupRaised(items, now).tiles.map((x) => [x.key, x.count]));
    expect(t).toEqual({ overdue: 2, open: 2, in_progress: 1, waiting: 1, done_this_week: 1 });
    expect(groupRaised(items, now).tiles.filter((x) => x.danger).map((x) => x.key)).toEqual(["overdue"]);
  });

  it("Done this week = done within the last 7 IST calendar days (today + 6 before)", () => {
    const inside = to(bob, { status: "done", doneAt: ist("2026-10-09T00:05") });
    const outside = to(bob, { status: "done", doneAt: ist("2026-10-08T23:55") });
    const g = groupRaised([inside, outside], now);
    expect(g.tiles.find((x) => x.key === "done_this_week")!.count).toBe(1);
    expect(shape(g)).toEqual([["recently_done", [inside.id, outside.id]]]);
  });

  it("people strip: assignees of open items with counts, overdue/waiting first, on-track last", () => {
    const items = [
      to(bob), // bob on track
      to(bob, { status: "in_progress" }),
      to(cat, { status: "waiting" }), // cat waiting
      to(dan, { dueAt: h(-5) }), // dan overdue
      to(dan),
      to(dan, { status: "done", doneAt: h(-1) }), // closed: not counted
    ];
    expect(groupRaised(items, now).people).toEqual([
      { person: dan, open: 2, overdue: 1, waiting: 0, onTrack: false },
      { person: cat, open: 1, overdue: 0, waiting: 1, onTrack: false },
      { person: bob, open: 2, overdue: 0, waiting: 0, onTrack: true },
    ]);
  });

  it("people with only closed items are left out", () => {
    expect(groupRaised([to(bob, { status: "done", doneAt: h(-1) })], now).people).toEqual([]);
  });

  it("people ties: more overdue first, then more open, then name", () => {
    const items = [
      to(cat, { dueAt: h(-1) }),
      to(bob, { dueAt: h(-1) }),
      to(dan, { dueAt: h(-1) }),
      to(dan, { dueAt: h(-2) }),
      to(cat),
    ];
    expect(groupRaised(items, now).people.map((p) => p.person.username)).toEqual(["dan", "cat", "bob"]);
  });

  it("sorts inside a bucket by priority, due, oldest", () => {
    const n = to(bob, { dueAt: h(5) });
    const u = to(bob, { priority: "urgent" });
    const n2 = to(bob, { dueAt: h(4) });
    const old = to(bob, { createdAt: h(-200) });
    const young = to(bob, { createdAt: h(-2) });
    expect(shape(groupRaised([young, n, old, u, n2], now))).toEqual([["active", [u.id, n2.id, n.id, old.id, young.id]]]);
  });
});
