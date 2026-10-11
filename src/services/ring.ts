import { eq } from "drizzle-orm";
import { ringSettings } from "@/db/schema";
import { normalizeUsername } from "@/lib/admin";
import * as audit from "./audit";
import { ValidationError } from "./errors";
import { requirePerson } from "./permissions";
import type { Actor, DbClient, Effect } from "./types";

export type RingSettings = { ntfyTopic: string; allowFrom: string[] };

/** My ring settings, or null when I haven't set a topic. Only ever read for yourself (the topic is a secret). */
export async function getMine(db: DbClient, actor: Actor): Promise<RingSettings | null> {
  const personId = requirePerson(actor);
  const [r] = await db.select().from(ringSettings).where(eq(ringSettings.personId, personId));
  return r ? { ntfyTopic: r.ntfyTopic, allowFrom: r.allowFrom } : null;
}

/** Save my topic and who may ring me ("@a, b" -> ["a","b"]; empty = anyone). An empty topic turns ringing off. */
export async function setMine(db: DbClient, actor: Actor, input: { ntfyTopic: string; allowFrom: string }): Promise<RingSettings | null> {
  const personId = requirePerson(actor);
  const ntfyTopic = input.ntfyTopic.trim();
  if (ntfyTopic && !/^[A-Za-z0-9_-]{1,64}$/.test(ntfyTopic)) throw new ValidationError("Topic: letters, numbers, - and _ only (max 64).");
  const allowFrom = [...new Set(input.allowFrom.split(/[\s,]+/).map(normalizeUsername).filter(Boolean))];
  if (allowFrom.some((u) => !/^[a-z0-9_]{3,32}$/.test(u))) throw new ValidationError("Usernames: Telegram @names, separated by commas.");
  if (!ntfyTopic) await db.delete(ringSettings).where(eq(ringSettings.personId, personId));
  else
    await db
      .insert(ringSettings)
      .values({ personId, ntfyTopic, allowFrom })
      .onConflictDoUpdate({ target: ringSettings.personId, set: { ntfyTopic, allowFrom, updatedAt: new Date() } });
  await audit.record(db, actor, { action: ntfyTopic ? "ring.set" : "ring.clear", entityType: "person", entityId: personId, summary: ntfyTopic ? "Updated urgent ring settings" : "Turned off urgent ring" });
  return ntfyTopic ? { ntfyTopic, allowFrom } : null;
}

/** Empty list = anyone; otherwise only those usernames (a sender with no username can't match). */
export const mayRing = (s: RingSettings, senderUsername: string | null | undefined) =>
  !s.allowFrom.length || (!!senderUsername && s.allowFrom.includes(normalizeUsername(senderUsername)));

/** The ring effect for an urgent request to `personId`, or none (no topic set, or the sender isn't allowed). */
export async function ringFor(db: DbClient, personId: number, senderUsername: string | null | undefined, message: { title: string; url: string }): Promise<Effect[]> {
  const [r] = await db.select().from(ringSettings).where(eq(ringSettings.personId, personId));
  return r && mayRing(r, senderUsername) ? [{ kind: "ring", topic: r.ntfyTopic, ...message }] : [];
}
