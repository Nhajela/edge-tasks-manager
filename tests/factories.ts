/**
 * Test data builders. Every DB test creates its own rows (no truncating), so ids must be unique across files and
 * workers: fake telegram ids live in 9_100_000_000–9_199_999_999 (never a real user) and usernames are random.
 */
import { randomInt } from "node:crypto";
import type { DbClient } from "@/db";
import { personActor, systemActor } from "@/lib/actor";
import * as people from "@/services/people";
import * as requests from "@/services/requests";
import type { Actor } from "@/services/types";
import type { Person } from "@/lib/types";

let n = 0;
export const fakeTelegramId = () => 9_100_000_000 + randomInt(0, 99_000_000) + (n++ % 1000);
export const fakeChatId = () => -(1_009_100_000_000 + randomInt(0, 99_000_000));
export const uniqueName = (prefix = "t") => `${prefix}_${randomInt(0, 2 ** 40).toString(36)}${n++}`;

export async function makePerson(
  db: DbClient,
  over: { username?: string | null; firstName?: string; startedBot?: boolean; telegramId?: number | null } = {},
): Promise<Person> {
  return people.upsertFromTelegram(db, systemActor(), {
    telegramId: over.telegramId === undefined ? fakeTelegramId() : over.telegramId,
    username: over.username === undefined ? uniqueName("u") : over.username,
    firstName: over.firstName ?? "Test",
    startedBot: over.startedBot ?? false,
  });
}

export const actorFor = (p: Person, opts: { isAdmin?: boolean; via?: Actor["via"] } = {}) =>
  personActor(p, { isAdmin: opts.isAdmin ?? false, via: opts.via ?? "web" });

/** A request raised by `requester` (created by them unless `by` is given) for `assignee`. */
export async function makeRequest(
  db: DbClient,
  opts: {
    requester?: Person;
    assignee?: Person;
    by?: Person;
    body?: string;
    chatId?: number | null;
    messageId?: number;
    title?: string;
  } = {},
) {
  const requester = opts.requester ?? (await makePerson(db));
  const assignee = opts.assignee ?? (await makePerson(db));
  const by = opts.by ?? requester;
  const chatId = opts.chatId === undefined ? fakeChatId() : opts.chatId;
  const res = await requests.create(db, actorFor(by, { via: chatId ? "telegram" : "web" }), {
    requesterId: requester.id,
    assigneeId: assignee.id,
    body: opts.body ?? "please fix the projector in the main hall",
    title: opts.title,
    chatId,
    chatTitle: chatId ? "Test group" : null,
    messages:
      chatId != null
        ? [{ messageId: opts.messageId ?? randomInt(1, 2 ** 31), fromId: requester.id, text: opts.body ?? "please fix the projector in the main hall" }]
        : [],
  });
  return { ...res, requester, assignee, by };
}
