import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import type { Session } from "./types";

const SESSION_COOKIE = "etm_session";
const PENDING_COOKIE = "etm_login";
const SESSION_DAYS = 60;

const secure = process.env.NODE_ENV === "production";

function sign(payload: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function encode(s: Session) {
  const payload = Buffer.from(JSON.stringify({ ...s, iat: Date.now() })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function decode(token: string | undefined): Session | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { iat, ...session } = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session & { iat?: number };
    // tokens expire server-side too, not just via cookie max-age
    if (!iat || Date.now() - iat > SESSION_DAYS * 24 * 3600_000) return null;
    return session;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  return decode((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function setSession(s: Session) {
  (await cookies()).set(SESSION_COOKIE, encode(s), {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 3600,
  });
}

export async function clearSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function getPendingCode() {
  return (await cookies()).get(PENDING_COOKIE)?.value ?? null;
}

export async function setPendingCode(code: string) {
  (await cookies()).set(PENDING_COOKIE, code, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 15 * 60,
  });
}

export async function clearPendingCode() {
  (await cookies()).delete(PENDING_COOKIE);
}
