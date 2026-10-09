import { and, asc, desc, eq, isNotNull, lt, sql, type SQL } from "drizzle-orm";
import { auditLog } from "@/db/schema";
import type { AuditEntry } from "@/lib/types";
import type { Actor, DbClient } from "./types";

export type AuditInput = {
  /** dotted verb, e.g. request.create, request.status, token.create, auth.login */
  action: string;
  entityType: string;
  entityId?: string | number | null;
  summary?: string;
  data?: Record<string, unknown> | null;
};

/** The ONE audit log. Every service mutation calls this exactly once. */
export async function record(db: DbClient, actor: Actor, e: AuditInput): Promise<AuditEntry> {
  const [row] = await db
    .insert(auditLog)
    .values({
      actorKind: actor.kind,
      actorPersonId: actor.personId,
      actorLabel: actor.displayName,
      via: actor.via,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId == null ? null : String(e.entityId),
      summary: e.summary ?? "",
      data: e.data ?? null,
    })
    .returning();
  return row;
}

/** Oldest first: a timeline. */
export async function listForEntity(db: DbClient, entityType: string, entityId: string | number): Promise<AuditEntry[]> {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, String(entityId))))
    .orderBy(asc(auditLog.at), asc(auditLog.id));
}

/** Newest first, for /admin/activity. Page with beforeId (the last id you got). */
export async function listRecent(
  db: DbClient,
  opts: { limit?: number; beforeId?: number; entityType?: string; entityId?: string | number; action?: string; actorPersonId?: number } = {},
): Promise<AuditEntry[]> {
  const where: SQL[] = [];
  if (opts.beforeId) where.push(lt(auditLog.id, opts.beforeId));
  if (opts.entityType) where.push(eq(auditLog.entityType, opts.entityType));
  if (opts.entityId != null) where.push(eq(auditLog.entityId, String(opts.entityId)));
  if (opts.action) where.push(eq(auditLog.action, opts.action));
  if (opts.actorPersonId) where.push(eq(auditLog.actorPersonId, opts.actorPersonId));
  return db
    .select()
    .from(auditLog)
    .where(and(...where))
    .orderBy(desc(auditLog.id))
    .limit(Math.min(opts.limit ?? 50, 500));
}

/** Filter options for /admin/activity: every action seen, and every person who acted (latest label). */
export async function facets(db: DbClient): Promise<{ actions: string[]; actors: { personId: number; label: string }[] }> {
  const [actions, actors] = await Promise.all([
    db.selectDistinct({ action: auditLog.action }).from(auditLog).orderBy(auditLog.action),
    db
      .selectDistinctOn([auditLog.actorPersonId], { personId: sql<number>`${auditLog.actorPersonId}`, label: auditLog.actorLabel })
      .from(auditLog)
      .where(isNotNull(auditLog.actorPersonId))
      .orderBy(auditLog.actorPersonId, desc(auditLog.id)),
  ]);
  return { actions: actions.map((a) => a.action), actors: actors.sort((a, b) => a.label.localeCompare(b.label)) };
}
