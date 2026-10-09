import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { apiTokens } from "@/db/schema";
import type { ApiToken } from "@/lib/types";
import * as audit from "./audit";
import { NotFoundError, PermissionError, TEXT_LIMITS, requireText } from "./errors";
import { requirePerson } from "./permissions";
import type { Actor, DbClient } from "./types";

export type TokenInfo = Omit<ApiToken, "tokenHash">;

const hash = (raw: string) => createHash("sha256").update(raw).digest("hex");
const strip = ({ tokenHash: _h, ...rest }: ApiToken): TokenInfo => rest;

/** Returns the raw etm_ token once; only its sha256 is stored. */
export async function create(db: DbClient, actor: Actor, input: { name: string }): Promise<{ token: string; row: ApiToken }> {
  const personId = requirePerson(actor);
  const name = requireText(input.name, "Token name", TEXT_LIMITS.name);
  const token = `etm_${randomBytes(24).toString("base64url")}`;
  const [row] = await db.insert(apiTokens).values({ personId, name, tokenHash: hash(token), prefix: token.slice(0, 8) }).returning();
  await audit.record(db, actor, { action: "token.create", entityType: "token", entityId: row.id, summary: name, data: { prefix: row.prefix } });
  return { token, row };
}

/** Bearer check for /api/mcp. Touches last_used_at (bookkeeping, not audited). */
export async function verify(db: DbClient, raw: string): Promise<{ personId: number; tokenId: number } | null> {
  if (!raw.startsWith("etm_")) return null;
  const [row] = await db
    .update(apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(apiTokens.tokenHash, hash(raw)), isNull(apiTokens.revokedAt)))
    .returning({ personId: apiTokens.personId, tokenId: apiTokens.id });
  return row ?? null;
}

export async function list(db: DbClient, actor: Actor): Promise<TokenInfo[]> {
  const rows = await db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.personId, requirePerson(actor)), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt));
  return rows.map(strip);
}

export async function revoke(db: DbClient, actor: Actor, id: number): Promise<TokenInfo> {
  const [row] = await db.select().from(apiTokens).where(eq(apiTokens.id, id));
  if (!row) throw new NotFoundError("No such token.");
  if (row.personId !== actor.personId && !actor.isAdmin) throw new PermissionError("That token isn't yours.");
  const [updated] = await db.update(apiTokens).set({ revokedAt: new Date() }).where(eq(apiTokens.id, id)).returning();
  await audit.record(db, actor, { action: "token.revoke", entityType: "token", entityId: id, summary: row.name });
  return strip(updated);
}
