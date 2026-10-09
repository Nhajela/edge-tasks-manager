import type { DbClient } from "@/db";
import * as people from "@/services/people";
import type { Actor } from "@/services/types";
import { isAdmin } from "./admin";
import { displayName } from "./names";
import type { Person, Session } from "./types";

export { displayName };

export function personActor(p: Person, opts: { isAdmin?: boolean; via?: Actor["via"]; kind?: "person" | "mcp" } = {}): Actor {
  return {
    kind: opts.kind ?? "person",
    personId: p.id,
    displayName: displayName(p),
    isAdmin: opts.isAdmin ?? isAdmin(p),
    via: opts.via ?? "web",
  };
}

export const systemActor = (label = "system"): Actor => ({ kind: "system", personId: null, displayName: label, isAdmin: true, via: "system" });

/** The titler. Not an admin: it may only touch fields humans haven't locked. */
export const aiActor = (label = "AI titler"): Actor => ({ kind: "ai", personId: null, displayName: label, isAdmin: false, via: "ai" });

/** Web: the logged-in person (created on first visit; logging in goes through the bot, so they started it). */
export async function actorFromSession(db: DbClient, session: Session): Promise<{ actor: Actor; person: Person }> {
  let person = await people.findByTelegramId(db, session.telegramId);
  // usernames come only from Telegram updates: a 60-day cookie's username may since belong to someone else
  // only a new row starts as DM-able: a notifier 403 (audited started_bot=false) is undone by /start, not a web visit
  if (!person)
    person = await people.upsertFromTelegram(db, systemActor(), { telegramId: session.telegramId, firstName: session.firstName, startedBot: true });
  return { actor: personActor(person, { via: "web" }), person };
}

/** Bot: the sender of a Telegram message/callback (upserted). */
export async function actorFromTelegram(
  db: DbClient,
  from: { id: number; username?: string; first_name?: string },
  opts: { startedBot?: boolean } = {},
): Promise<{ actor: Actor; person: Person }> {
  const person = await people.upsertFromTelegram(db, systemActor(), {
    telegramId: from.id,
    username: from.username ?? undefined,
    firstName: from.first_name,
    startedBot: opts.startedBot,
  });
  return { actor: personActor(person, { via: "telegram" }), person };
}

/** MCP: the person behind an API token. */
export function actorFromToken(person: Person): Actor {
  return personActor(person, { via: "mcp", kind: "mcp" });
}
