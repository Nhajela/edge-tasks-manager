import type { Person } from "./types";

/** "@bob", or the first name when they have no username. Plain text, not HTML. */
export function displayName(p: Pick<Person, "username" | "firstName"> | null | undefined) {
  if (!p) return "someone";
  return p.username ? `@${p.username}` : p.firstName || "someone";
}
