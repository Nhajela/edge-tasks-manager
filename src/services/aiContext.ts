/** The AI titler's memory: facts (admin-written) and questions (AI-asked, admin-answered). */
import { and, asc, eq, or, type SQL } from "drizzle-orm";
import { aiContext } from "@/db/schema";
import type { AiContextItem } from "@/lib/types";
import * as audit from "./audit";
import { NotFoundError, PermissionError, TEXT_LIMITS, requireText } from "./errors";
import { requireAdmin } from "./permissions";
import type { Actor, DbClient } from "./types";

const LIMIT = TEXT_LIMITS.comment;

async function load(db: DbClient, id: number) {
  const [row] = await db.select().from(aiContext).where(eq(aiContext.id, id));
  if (!row) throw new NotFoundError("No such context item.");
  return row;
}

async function update(db: DbClient, actor: Actor, id: number, set: Partial<AiContextItem>, action: string, summary: string) {
  await load(db, id);
  const [row] = await db.update(aiContext).set(set).where(eq(aiContext.id, id)).returning();
  await audit.record(db, actor, { action, entityType: "ai_context", entityId: id, summary });
  return row;
}

export async function list(
  db: DbClient,
  actor: Actor,
  filter: { kind?: "fact" | "question"; status?: "open" | "answered" | "dismissed" } = {},
): Promise<AiContextItem[]> {
  requireAdmin(actor);
  const where: SQL[] = [];
  if (filter.kind) where.push(eq(aiContext.kind, filter.kind));
  if (filter.status) where.push(eq(aiContext.status, filter.status));
  return db.select().from(aiContext).where(and(...where)).orderBy(asc(aiContext.id));
}

/** What goes into the titler prompt: live facts plus answered questions. */
export async function promptItems(db: DbClient): Promise<AiContextItem[]> {
  return db
    .select()
    .from(aiContext)
    .where(or(and(eq(aiContext.kind, "fact"), eq(aiContext.status, "open")), eq(aiContext.status, "answered")))
    .orderBy(asc(aiContext.id));
}

export async function addFact(db: DbClient, actor: Actor, text: string): Promise<AiContextItem> {
  requireAdmin(actor);
  const t = requireText(text, "Fact", LIMIT);
  const [row] = await db.insert(aiContext).values({ kind: "fact", text: t, createdById: actor.personId }).returning();
  await audit.record(db, actor, { action: "ai_context.fact", entityType: "ai_context", entityId: row.id, summary: t });
  return row;
}

export async function updateFact(db: DbClient, actor: Actor, id: number, text: string): Promise<AiContextItem> {
  requireAdmin(actor);
  const t = requireText(text, "Fact", LIMIT);
  return update(db, actor, id, { text: t }, "ai_context.update", t);
}

/** Deletes a fact (or any item) outright. */
export async function remove(db: DbClient, actor: Actor, id: number): Promise<void> {
  requireAdmin(actor);
  const row = await load(db, id);
  await db.delete(aiContext).where(eq(aiContext.id, id));
  await audit.record(db, actor, { action: "ai_context.delete", entityType: "ai_context", entityId: id, summary: row.text });
}

/** The AI (or an admin) asks something that would help it title better. */
export async function addQuestion(db: DbClient, actor: Actor, input: { text: string; requestId?: number | null }): Promise<AiContextItem> {
  if (actor.kind !== "ai" && !actor.isAdmin) throw new PermissionError("Only the AI or an admin can add questions.");
  const t = requireText(input.text, "Question", LIMIT);
  const [row] = await db
    .insert(aiContext)
    .values({ kind: "question", text: t, requestId: input.requestId ?? null, createdById: actor.personId })
    .returning();
  await audit.record(db, actor, {
    action: "ai_context.question",
    entityType: "ai_context",
    entityId: row.id,
    summary: t,
    data: { requestId: row.requestId },
  });
  return row;
}

export async function answer(db: DbClient, actor: Actor, id: number, text: string): Promise<AiContextItem> {
  requireAdmin(actor);
  const a = requireText(text, "Answer", LIMIT);
  return update(db, actor, id, { answer: a, status: "answered" }, "ai_context.answer", a);
}

export async function dismiss(db: DbClient, actor: Actor, id: number): Promise<AiContextItem> {
  requireAdmin(actor);
  return update(db, actor, id, { status: "dismissed" }, "ai_context.dismiss", "Dismissed");
}
