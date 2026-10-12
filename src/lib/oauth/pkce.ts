import { createHash, timingSafeEqual } from "node:crypto";

export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const digest = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const expected = Buffer.from(challenge);
  return digest.length === expected.length && timingSafeEqual(digest, expected);
}
