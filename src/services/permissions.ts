import type { Request } from "@/lib/types";
import { PermissionError } from "./errors";
import type { Actor } from "./types";

type Parties = Pick<Request, "requesterId" | "assigneeId" | "createdById">;

export const isParticipant = (actor: Actor, r: Parties) =>
  actor.personId != null && [r.requesterId, r.assigneeId, r.createdById].includes(actor.personId);

/** Requester, assignee, creator, admins, and the system/AI. */
export const canView = (actor: Actor, r: Parties) =>
  actor.isAdmin || actor.kind === "system" || actor.kind === "ai" || isParticipant(actor, r);

/** Status, comments, title/priority/due: same people as canView (the AI is further limited by lock flags). */
export const canManage = canView;

export function requireView(actor: Actor, r: Parties) {
  if (!canView(actor, r)) throw new PermissionError("Only the people on this request can see it.");
}

export function requireManage(actor: Actor, r: Parties) {
  if (!canManage(actor, r)) throw new PermissionError("Only the requester, the assignee or an admin can change this request.");
}

export function requireAdmin(actor: Actor) {
  if (!actor.isAdmin) throw new PermissionError("Admins only.");
}

export function requirePerson(actor: Actor): number {
  if (actor.personId == null) throw new PermissionError("This needs a person, not a system actor.");
  return actor.personId;
}
