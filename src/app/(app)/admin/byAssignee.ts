import { CLOSED, PRIORITIES } from "@/lib/constants";
import type { Person } from "@/lib/types";
import type { ListItem } from "@/services/requests";

export type AssigneeGroup = { person: Person; open: number; overdue: number; items: ListItem[] };

const isOpen = (r: ListItem) => !CLOSED.includes(r.status);
const isOverdue = (r: ListItem, now: Date) => isOpen(r) && r.dueAt != null && +r.dueAt < +now;
const time = (d: Date | null) => (d ? +new Date(d) : Infinity);

/** SPEC shared row order, with closed rows last (admin can list every status at once). */
const rowOrder = (a: ListItem, b: ListItem) =>
  Number(isOpen(b)) - Number(isOpen(a)) ||
  PRIORITIES.indexOf(b.priority) - PRIORITIES.indexOf(a.priority) ||
  time(a.dueAt) - time(b.dueAt) ||
  +new Date(a.createdAt) - +new Date(b.createdAt) ||
  a.id - b.id;

/** /admin: one group per assignee; people with overdue work first, then most open, then name. */
export function byAssignee(items: ListItem[], now: Date): AssigneeGroup[] {
  const map = new Map<number, AssigneeGroup>();
  for (const r of items) {
    const g = map.get(r.assigneeId) ?? { person: r.assignee, open: 0, overdue: 0, items: [] };
    g.items.push(r);
    g.open += Number(isOpen(r));
    g.overdue += Number(isOverdue(r, now));
    map.set(r.assigneeId, g);
  }
  const name = (p: Person) => (p.firstName ?? p.username ?? "").toLowerCase();
  return [...map.values()]
    .map((g) => ({ ...g, items: g.items.sort(rowOrder) }))
    .sort((a, b) => b.overdue - a.overdue || b.open - a.open || name(a.person).localeCompare(name(b.person)));
}
