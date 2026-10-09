import { randomBytes } from "crypto";
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { loginCodes } from "@/db/schema";
import type { Session } from "./types";

const CODE_TTL_MIN = 10; // time to tap Start in Telegram
const CLAIM_TTL_MIN = 30; // time to come back to the browser after tapping Start

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

export function newCode() {
  // Telegram deep-link start params allow [A-Za-z0-9_-], max 64 chars
  return randomBytes(18).toString("base64url");
}

export async function createCode(): Promise<string> {
  const code = newCode();
  await db().insert(loginCodes).values({ code });
  // opportunistic cleanup (long-lived bot links carry their own expiry)
  await db()
    .delete(loginCodes)
    .where(
      or(
        lt(loginCodes.expiresAt, new Date()),
        and(isNull(loginCodes.expiresAt), lt(loginCodes.createdAt, minutesAgo(24 * 60))),
      ),
    );
  return code;
}

/** Bot side: someone tapped Start with this code. Returns false if unknown/expired/used. */
export async function claimCode(code: string, s: Session): Promise<boolean> {
  const rows = await db()
    .update(loginCodes)
    .set({ telegramId: Number(s.telegramId), username: s.username, firstName: s.firstName, claimedAt: sql`now()` })
    .where(
      and(eq(loginCodes.code, code), isNull(loginCodes.claimedAt), gt(loginCodes.createdAt, minutesAgo(CODE_TTL_MIN))),
    )
    .returning({ code: loginCodes.code });
  return rows.length > 0;
}

/** Bot side: is this a fresh, unclaimed code from someone pressing "Log in" on the site? */
export async function isPendingCode(code: string): Promise<boolean> {
  const [r] = await db()
    .select({ code: loginCodes.code })
    .from(loginCodes)
    .where(and(eq(loginCodes.code, code), isNull(loginCodes.claimedAt), gt(loginCodes.createdAt, minutesAgo(CODE_TTL_MIN))));
  return Boolean(r);
}

/** Bot side: mint an already-claimed code for a magic login link. */
export async function createClaimedCode(s: Session, ttlMin = CLAIM_TTL_MIN): Promise<string> {
  const code = newCode();
  await db()
    .insert(loginCodes)
    .values({
      code,
      telegramId: Number(s.telegramId),
      username: s.username,
      firstName: s.firstName,
      claimedAt: new Date(),
      expiresAt: new Date(Date.now() + ttlMin * 60_000),
    });
  return code;
}

/** A claimed code is usable until its own expiry, or 30 min after claiming for codes without one. */
const claimValid = (r: { claimedAt: Date | null; expiresAt: Date | null }) =>
  Boolean(r.claimedAt) && (r.expiresAt ? r.expiresAt > new Date() : r.claimedAt! > minutesAgo(CLAIM_TTL_MIN));

export type CodeState = { status: "pending" } | { status: "expired" } | { status: "ok"; session: Session };

/** Browser side: check a code. A claimed code logs you in once, then is consumed. */
export async function redeemCode(code: string): Promise<CodeState> {
  const [r] = await db().select().from(loginCodes).where(eq(loginCodes.code, code));
  if (!r) return { status: "expired" };
  if (!r.claimedAt) return r.createdAt > minutesAgo(CODE_TTL_MIN) ? { status: "pending" } : { status: "expired" };
  if (!claimValid(r) || !r.telegramId) return { status: "expired" };
  // delete-returning makes the code single-use even if poll and magic link race
  const consumed = await db().delete(loginCodes).where(eq(loginCodes.code, code)).returning({ code: loginCodes.code });
  if (!consumed.length) return { status: "expired" };
  return { status: "ok", session: { telegramId: String(r.telegramId), username: r.username, firstName: r.firstName ?? "" } };
}

/** Look at a magic-link code without consuming it (for the "Continue as …" confirm page). */
export async function peekClaimedCode(code: string): Promise<Session | null> {
  const [r] = await db().select().from(loginCodes).where(eq(loginCodes.code, code));
  if (!r?.claimedAt || !r.telegramId || !claimValid(r)) return null;
  return { telegramId: String(r.telegramId), username: r.username, firstName: r.firstName ?? "" };
}

/** Audit a login (auth.login) through the one audit log. Never throws: a log failure must not block logging in. */
export async function recordLogin(s: Session, how: string) {
  try {
    const { actorFromSession } = await import("./actor");
    const { record } = await import("@/services/audit");
    const { actor } = await actorFromSession(db(), s);
    await record(db(), actor, { action: "auth.login", entityType: "person", entityId: actor.personId, summary: how });
  } catch (e) {
    console.error("auth.login audit failed", e);
  }
}
