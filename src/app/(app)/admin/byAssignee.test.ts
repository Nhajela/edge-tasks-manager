import { describe, expect, it } from "vitest";
import type { ListItem } from "@/services/requests";
import { byAssignee } from "./byAssignee";

const now = new Date("2026-10-14T04:30:00Z");
const h = (n: number) => new Date(now.getTime() + n * 3600_000);
let seq = 9100000000;
const person = (id: number, firstName: string) => ({ id, firstName, username: firstName.toLowerCase() }) as ListItem["assignee"];
const ann = person(1, "Ann");
const bob = person(2, "Bob");
const cy = person(3, "Cy");
const row = (assignee: ListItem["assignee"], p: Partial<ListItem> = {}) =>
  ({ id: ++seq, status: "open", priority: "normal", dueAt: null, createdAt: h(-48), assignee, assigneeId: assignee.id, ...p }) as ListItem;

describe("byAssignee", () => {
  it("one group per assignee with open/overdue counts; overdue people first, then most open, then name", () => {
    const a1 = row(ann);
    const a2 = row(ann, { status: "done", dueAt: h(-50) }); // closed: neither open nor overdue
    const b1 = row(bob, { dueAt: h(-5) });
    const c1 = row(cy);
    const c2 = row(cy, { status: "waiting" });
    const g = byAssignee([a1, a2, b1, c1, c2], now);
    expect(g.map((x) => [x.person.id, x.open, x.overdue, x.items.length])).toEqual([
      [2, 1, 1, 1],
      [3, 2, 0, 2],
      [1, 1, 0, 2],
    ]);
  });

  it("sorts rows open first, then priority (urgent first), due ascending (undated last), oldest", () => {
    const done = row(ann, { status: "done", priority: "urgent" });
    const low = row(ann, { priority: "low" });
    const urgent = row(ann, { priority: "urgent" });
    const dueLater = row(ann, { dueAt: h(30) });
    const dueSoon = row(ann, { dueAt: h(3) });
    const old = row(ann, { createdAt: h(-90) });
    const g = byAssignee([done, low, old, dueLater, urgent, dueSoon], now);
    expect(g[0].items.map((i) => i.id)).toEqual([urgent.id, dueSoon.id, dueLater.id, old.id, low.id, done.id]);
  });
});
