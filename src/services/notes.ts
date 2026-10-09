import { and, eq } from "drizzle-orm";
import { privateNotes, requests } from "@/db/schema";
import * as audit from "./audit";
import { NotFoundError, TEXT_LIMITS, ValidationError } from "./errors";
import { requireAdmin, requirePerson, requireView } from "./permissions";
import type { Actor, DbClient } from "./types";

export type PrivateNote = typeof privateNotes.$inferSelect;

async function viewable(db: DbClient, actor: Actor, requestId: number) {
  const [r] = await db.select().from(requests).where(eq(requests.id, requestId));
  if (!r) throw new NotFoundError(`Request #${requestId} not found.`);
  requireView(actor, r);
  return r;
}

/** The viewer's own private note on a request, or null. */
export async function getMine(db: DbClient, actor: Actor, requestId: number): Promise<string | null> {
  const personId = requirePerson(actor);
  await viewable(db, actor, requestId);
  const [n] = await db.select().from(privateNotes).where(and(eq(privateNotes.requestId, requestId), eq(privateNotes.personId, personId)));
  return n?.text ?? null;
}

/**
 * Replace my private note ("" clears it). Anyone who can see the request may keep one. Audited as entity "note"
 * with no text, so the request timeline (entity "request") never shows it.
 */
export async function set(db: DbClient, actor: Actor, requestId: number, text: string): Promise<string | null> {
  const personId = requirePerson(actor);
  await viewable(db, actor, requestId);
  const t = text.trim();
  if (t.length > TEXT_LIMITS.body) throw new ValidationError(`Note is too long (max ${TEXT_LIMITS.body} characters).`);
  if (!t) await db.delete(privateNotes).where(and(eq(privateNotes.requestId, requestId), eq(privateNotes.personId, personId)));
  else
    await db
      .insert(privateNotes)
      .values({ requestId, personId, text: t })
      .onConflictDoUpdate({ target: [privateNotes.requestId, privateNotes.personId], set: { text: t, updatedAt: new Date() } });
  await audit.record(db, actor, { action: t ? "note.set" : "note.clear", entityType: "note", entityId: requestId, summary: t ? "Updated a private note" : "Cleared a private note" });
  return t || null;
}

/** Add a line to my note (the bot's /note). */
export async function append(db: DbClient, actor: Actor, requestId: number, line: string): Promise<string | null> {
  const before = await getMine(db, actor, requestId);
  return set(db, actor, requestId, [before, line.trim()].filter(Boolean).join("\n"));
}

/** Everyone's notes on a request: admins only (SPEC: the superadmin can read private notes). */
export async function listAll(db: DbClient, actor: Actor, requestId: number): Promise<PrivateNote[]> {
  requireAdmin(actor);
  await viewable(db, actor, requestId);
  return db.select().from(privateNotes).where(eq(privateNotes.requestId, requestId));
}
