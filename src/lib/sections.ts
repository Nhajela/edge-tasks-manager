import type { ListItem } from "@/services/requests";

/** /with: never interleave directions (SPEC "Grouping"). Buckets come from services/grouping. */
export function splitWith(items: ListItem[], meId: number) {
  return { toMe: items.filter((i) => i.assigneeId === meId), byMe: items.filter((i) => i.assigneeId !== meId) };
}
