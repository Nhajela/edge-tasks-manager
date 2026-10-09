/**
 * ponytail: stand-in for src/services/grouping.ts while its bodies are stubs (r2/grouping lands separately).
 * Use as `vi.mock("@/services/grouping", (orig) => withGroupingFallback(orig))`: the real functions win as soon as
 * they stop throwing "not implemented", so this file can be deleted after the merge. Follows the SPEC buckets only as
 * far as the bot/MCP tests need (no tiles, no people strip).
 */
import { istDayKey } from "@/lib/format";
import type * as G from "@/services/grouping";
import type { ListItem } from "@/services/requests";

const RANK = { urgent: 0, high: 1, normal: 2, low: 3 } as const;
const sort = (xs: ListItem[]) =>
  xs.sort(
    (a, b) =>
      RANK[a.priority] - RANK[b.priority] ||
      (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity) ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );
const days = (d: Date, now: Date) => Math.round((Date.parse(istDayKey(d)) - Date.parse(istDayKey(now))) / 86400_000);
const closed = (r: ListItem) => r.status === "done" || r.status === "declined";

function build<K extends string>(keys: readonly K[], titles: Record<K, string>, items: ListItem[], pick: (r: ListItem) => K) {
  return keys
    .map((key) => {
      const its = sort(items.filter((r) => pick(r) === key));
      return { key, title: titles[key], count: its.length, items: its, collapsedByDefault: key === "done" || key === "recently_done" };
    })
    .filter((g) => g.count > 0);
}

const fakeInbox: typeof G.groupInbox = (items, now) => ({
  groups: build(["new", "act", "upcoming", "waiting", "done"], { new: "New", act: "Act", upcoming: "Upcoming", waiting: "Waiting", done: "Done" }, items, (r) =>
    closed(r) ? "done" : r.status === "waiting" ? "waiting" : r.status === "open" && !r.assigneeSeenAt ? "new" : !r.dueAt || days(r.dueAt, now) <= 1 ? "act" : "upcoming",
  ),
});

const fakeRaised: typeof G.groupRaised = (items, now) => ({
  groups: build(["overdue", "active", "waiting", "recently_done"], { overdue: "Overdue", active: "Active", waiting: "Waiting", recently_done: "Recently done" }, items, (r) =>
    closed(r) ? "recently_done" : r.dueAt && r.dueAt < now ? "overdue" : r.status === "waiting" ? "waiting" : "active",
  ),
  tiles: [],
  people: [],
});

const orFake =
  <F extends (...a: never[]) => unknown>(real: F, fake: F) =>
  ((...a: Parameters<F>) => {
    try {
      return real(...a);
    } catch (e) {
      if (e instanceof Error && e.message === "not implemented") return fake(...a);
      throw e;
    }
  }) as F;

export async function withGroupingFallback(orig: () => Promise<unknown>) {
  const real = (await orig()) as typeof G;
  return { ...real, groupInbox: orFake(real.groupInbox, fakeInbox), groupRaised: orFake(real.groupRaised, fakeRaised) };
}
