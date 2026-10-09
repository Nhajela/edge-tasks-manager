import { eq, inArray } from "drizzle-orm";
import { aiContext, apiTokens, auditLog, pendingPrompts, people, requestMessages, requests } from "@/db/schema";
import { normalizeUsername, superadminTelegramId, superadminUsername } from "@/lib/admin";
import { displayName } from "@/lib/names";
import type { Person } from "@/lib/types";
import * as audit from "./audit";
import { NotFoundError, ValidationError } from "./errors";
import type { Actor, DbClient } from "./types";

export type TelegramPersonInput = {
  telegramId?: number | string | null;
  /** undefined = unknown (keep what we have); null/"" = they have none */
  username?: string | null;
  firstName?: string | null;
  /** true when they DM'd the bot; omit to leave as is */
  startedBot?: boolean;
};

const cleanUsername = (u: string | null | undefined) => (u ? normalizeUsername(u) || null : null);

export async function getById(db: DbClient, id: number): Promise<Person | null> {
  const [p] = await db.select().from(people).where(eq(people.id, id));
  return p ?? null;
}

export async function getMany(db: DbClient, ids: number[]): Promise<Person[]> {
  if (!ids.length) return [];
  return db.select().from(people).where(inArray(people.id, [...new Set(ids)]));
}

export async function findByUsername(db: DbClient, username: string): Promise<Person | null> {
  const u = cleanUsername(username);
  if (!u) return null;
  const [p] = await db.select().from(people).where(eq(people.username, u));
  return p ?? null;
}

export async function findByTelegramId(db: DbClient, telegramId: number | string): Promise<Person | null> {
  const [p] = await db.select().from(people).where(eq(people.telegramId, Number(telegramId)));
  return p ?? null;
}

/**
 * Point everything that referenced a username-only placeholder at the real person, then drop the placeholder.
 * Sequential idempotent statements (no transactions on neon-http): safe to re-run if interrupted.
 */
async function mergeInto(db: DbClient, placeholderId: number, realId: number) {
  await db.update(requests).set({ requesterId: realId }).where(eq(requests.requesterId, placeholderId));
  await db.update(requests).set({ assigneeId: realId }).where(eq(requests.assigneeId, placeholderId));
  await db.update(requests).set({ createdById: realId }).where(eq(requests.createdById, placeholderId));
  await db.update(requestMessages).set({ fromId: realId }).where(eq(requestMessages.fromId, placeholderId));
  await db.update(auditLog).set({ actorPersonId: realId }).where(eq(auditLog.actorPersonId, placeholderId));
  await db.update(apiTokens).set({ personId: realId }).where(eq(apiTokens.personId, placeholderId));
  await db.update(aiContext).set({ createdById: realId }).where(eq(aiContext.createdById, placeholderId));
  await db.update(pendingPrompts).set({ requesterId: realId }).where(eq(pendingPrompts.requesterId, placeholderId));
  await db.update(pendingPrompts).set({ assigneeId: realId }).where(eq(pendingPrompts.assigneeId, placeholderId));
  await db.update(pendingPrompts).set({ createdById: realId }).where(eq(pendingPrompts.createdById, placeholderId));
  await db.delete(people).where(eq(people.id, placeholderId));
}

/**
 * Called for every Telegram user we see (senders, reply authors, @mentions, text_mentions). One row per person:
 * - a known telegram_id refreshes its username/name (no audit row: a refresh is not a change anyone made);
 * - a username-only placeholder gets bound to the id (person.bind), merging if the id already had a row;
 * - a username that moved to another account is taken off the old row.
 * New rows are audited as person.create.
 */
export async function upsertFromTelegram(db: DbClient, actor: Actor, input: TelegramPersonInput): Promise<Person> {
  const telegramId = input.telegramId != null && input.telegramId !== "" ? Number(input.telegramId) : null;
  const username = cleanUsername(input.username);
  const firstName = input.firstName?.trim() || null;
  if (!telegramId && !username) throw new ValidationError("A person needs a Telegram id or a username.");

  const byName = username ? await findByUsername(db, username) : null;
  if (!telegramId) {
    if (byName) return byName;
    const [created] = await db.insert(people).values({ username }).onConflictDoNothing().returning();
    if (!created) return (await findByUsername(db, username!))!; // lost a race to a concurrent webhook
    await audit.record(db, actor, { action: "person.create", entityType: "person", entityId: created.id, summary: displayName(created) });
    return created;
  }

  let byId = await findByTelegramId(db, telegramId);
  let bound: "bind" | "merge" | null = null;
  if (byName && byName.id !== byId?.id) {
    if (byName.telegramId == null && !byId) {
      byId = byName; // the placeholder becomes the real row
      bound = "bind";
    } else if (byName.telegramId == null && byId) {
      await mergeInto(db, byName.id, byId.id);
      bound = "merge";
    } else {
      // username was recycled by another account
      await db.update(people).set({ username: null, updatedAt: new Date() }).where(eq(people.id, byName.id));
    }
  }

  const set = {
    telegramId,
    // only overwrite the username when we were told one (a text_mention has none, but they may still have one)
    ...(input.username !== undefined ? { username } : {}),
    ...(firstName ? { firstName } : {}),
    ...(input.startedBot !== undefined ? { startedBot: input.startedBot } : {}),
    updatedAt: new Date(),
  };
  if (byId) {
    const [updated] = await db.update(people).set(set).where(eq(people.id, byId.id)).returning();
    if (bound)
      await audit.record(db, actor, {
        action: "person.bind",
        entityType: "person",
        entityId: updated.id,
        summary: `${displayName(updated)} linked to their Telegram account`,
        data: bound === "merge" ? { mergedPlaceholderId: byName!.id } : null,
      });
    return updated;
  }
  const [created] = await db
    .insert(people)
    .values({ telegramId, username, firstName, startedBot: input.startedBot ?? false })
    .onConflictDoNothing()
    .returning();
  if (!created) {
    const [updated] = await db.update(people).set(set).where(eq(people.telegramId, telegramId)).returning();
    return updated;
  }
  await audit.record(db, actor, { action: "person.create", entityType: "person", entityId: created.id, summary: displayName(created) });
  return created;
}

/** Bind a known telegram id to an @username (e.g. the placeholder created when someone was @mentioned). */
export function bindTelegramId(db: DbClient, actor: Actor, username: string, telegramId: number | string): Promise<Person> {
  return upsertFromTelegram(db, actor, { telegramId, username });
}

/** Bots can only DM people who started them; a 403 means that's no longer true. */
export async function setStartedBot(db: DbClient, actor: Actor, personId: number, started: boolean): Promise<Person> {
  const [p] = await db.update(people).set({ startedBot: started, updatedAt: new Date() }).where(eq(people.id, personId)).returning();
  if (!p) throw new NotFoundError("No such person.");
  await audit.record(db, actor, {
    action: "person.started_bot",
    entityType: "person",
    entityId: p.id,
    summary: started ? "Can receive DMs" : "Can no longer receive DMs",
    data: { started },
  });
  return p;
}

/** The organiser: default assignee for /request without an @. Created as a placeholder if never seen. */
export async function superadmin(db: DbClient, actor: Actor): Promise<Person | null> {
  const id = superadminTelegramId();
  if (id) {
    const p = await findByTelegramId(db, id);
    if (p) return p;
  }
  const u = superadminUsername();
  return u ? upsertFromTelegram(db, actor, { username: u }) : null;
}
