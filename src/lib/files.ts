import { createHmac, timingSafeEqual } from "node:crypto";
import { SITE_URL } from "./constants";

function secret() {
  const s = process.env.FILES_SECRET || process.env.SESSION_SECRET;
  if (!s) throw new Error("FILES_SECRET or SESSION_SECRET must be set");
  return s;
}

/** Attachments are public by signed URL: no enumeration, and AI clients can fetch them without auth. */
export function signFileId(id: number): string {
  return createHmac("sha256", secret()).update(`file:${id}`).digest("base64url").slice(0, 32);
}

export function verifyFileSig(id: number, sig: string | null | undefined): boolean {
  if (!sig) return false;
  const a = Buffer.from(signFileId(id));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function fileUrl(id: number): string {
  return `${SITE_URL}/api/files/${id}?sig=${signFileId(id)}`;
}
