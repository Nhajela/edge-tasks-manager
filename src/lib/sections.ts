import type { ListItem } from "@/services/requests";
import { PRIORITIES } from "./constants";
import type { Status } from "./types";

export type Section = { key: string; label: string; items: ListItem[]; collapsed: boolean };

const time = (d: Date | null) => (d ? +new Date(d) : Infinity);
/** Due soonest first (so overdue leads), no due last; then higher priority; then oldest. */
const needsOrder = (a: ListItem, b: ListItem) =>
  time(a.dueAt) - time(b.dueAt) ||
  PRIORITIES.indexOf(b.priority) - PRIORITIES.indexOf(a.priority) ||
  +new Date(a.createdAt) - +new Date(b.createdAt) ||
  a.id - b.id;

const LAYOUT: Record<"inbox" | "raised", { key: string; label: string; statuses: Status[]; collapsed?: boolean; keep?: boolean }[]> = {
  inbox: [
    { key: "needs", label: "Needs you", statuses: ["open", "in_progress"], keep: true },
    { key: "waiting", label: "Waiting", statuses: ["waiting"] },
    { key: "done", label: "Done", statuses: ["done", "declined"], collapsed: true },
  ],
  raised: [
    { key: "open", label: "Not started", statuses: ["open"] },
    { key: "doing", label: "In progress", statuses: ["in_progress"] },
    { key: "waiting", label: "Waiting", statuses: ["waiting"] },
    { key: "done", label: "Done", statuses: ["done", "declined"], collapsed: true },
  ],
};

/** SPEC "Grouping": status sections for one direction. Empty sections are dropped, except inbox "Needs you". */
export function toSections(items: ListItem[], mode: "inbox" | "raised"): Section[] {
  return LAYOUT[mode]
    .map(({ key, label, statuses, collapsed = false }) => {
      const rows = items.filter((i) => statuses.includes(i.status));
      return { key, label, collapsed, items: key === "needs" ? rows.sort(needsOrder) : rows };
    })
    .filter((s, i) => s.items.length || LAYOUT[mode][i].keep);
}

/** /with: never interleave directions. */
export function splitWith(items: ListItem[], meId: number) {
  return { toMe: items.filter((i) => i.assigneeId === meId), byMe: items.filter((i) => i.assigneeId !== meId) };
}
