import { describe, expect, it } from "vitest";
import type { ListItem } from "@/services/requests";
import { splitWith, toSections } from "./sections";

const now = new Date("2026-10-14T04:30:00Z");
const h = (n: number) => new Date(now.getTime() + n * 3600_000);
let seq = 0;
const row = (p: Partial<ListItem>) =>
  ({ id: ++seq, status: "open", priority: "normal", dueAt: null, createdAt: h(-48), updatedAt: h(-48), assigneeId: 1, requesterId: 2, ...p }) as ListItem;
const keys = (s: ReturnType<typeof toSections>) => s.map((x) => [x.key, x.items.map((i) => i.id)]);

describe("toSections inbox", () => {
  it("Needs you sorts overdue, then due soonest, then priority, then oldest; Waiting and Done follow", () => {
    const old = row({ createdAt: h(-90) });
    const young = row({ createdAt: h(-10) });
    const urgent = row({ priority: "urgent" });
    const dueSoon = row({ dueAt: h(5), status: "in_progress" });
    const overdue = row({ dueAt: h(-5) });
    const waiting = row({ status: "waiting", customStatus: "parts" });
    const declined = row({ status: "declined" });
    const done = row({ status: "done" });
    const s = toSections([young, waiting, done, old, urgent, dueSoon, declined, overdue], "inbox");
    expect(keys(s)).toEqual([
      ["needs", [overdue.id, dueSoon.id, urgent.id, old.id, young.id]],
      ["waiting", [waiting.id]],
      ["done", [done.id, declined.id]],
    ]);
    expect(s.map((x) => x.collapsed)).toEqual([false, false, true]);
  });

  it("hides empty sections but always keeps Needs you", () => {
    expect(keys(toSections([row({ status: "waiting" })], "inbox")).map((k) => k[0])).toEqual(["needs", "waiting"]);
    expect(toSections([], "inbox").map((x) => x.key)).toEqual(["needs"]);
  });
});

describe("toSections raised", () => {
  it("Not started, In progress, Waiting, Done (collapsed); empty ones hidden", () => {
    const a = row({}), b = row({ status: "in_progress" }), c = row({ status: "declined" });
    const s = toSections([a, b, c], "raised");
    expect(keys(s)).toEqual([["open", [a.id]], ["doing", [b.id]], ["done", [c.id]]]);
    expect(s.at(-1)!.collapsed).toBe(true);
    expect(toSections([], "raised")).toEqual([]);
  });
});

describe("splitWith", () => {
  it("splits /with rows into asked-me and I-asked", () => {
    const toMe = row({ assigneeId: 1, requesterId: 2 }), mine = row({ assigneeId: 2, requesterId: 1 });
    expect(splitWith([mine, toMe], 1)).toEqual({ toMe: [toMe], byMe: [mine] });
  });
});
