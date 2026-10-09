import { describe, expect, it } from "vitest";
import { testDb } from "@tests/helpers/db";
import { eq } from "drizzle-orm";
import { actorFor, fakeChatId, fakeTelegramId, makePerson, makeRequest, uniqueName } from "@tests/factories";
import { pendingPrompts } from "@/db/schema";
import { actorFromSession, systemActor } from "@/lib/actor";
import * as prompts from "@/services/prompts";
import * as audit from "@/services/audit";
import * as people from "@/services/people";
import * as requests from "@/services/requests";

const db = testDb();
const sys = systemActor();

describe("people.upsertFromTelegram", () => {
  it("creates once per telegram id, lowercases usernames, refreshes names; audits only the create", async () => {
    const tid = fakeTelegramId();
    const name = uniqueName("Bob");
    const a = await people.upsertFromTelegram(db, sys, { telegramId: tid, username: `@${name}`, firstName: "Bob" });
    expect(a.username).toBe(name.toLowerCase());
    const b = await people.upsertFromTelegram(db, sys, { telegramId: tid, username: name, firstName: "Robert" });
    expect(b.id).toBe(a.id);
    expect(b.firstName).toBe("Robert");
    const log = await audit.listForEntity(db, "person", String(a.id));
    expect(log.map((r) => r.action)).toEqual(["person.create"]);
  });

  it("creates a username-only placeholder and binds the telegram id when the person shows up", async () => {
    const name = uniqueName("carol");
    const placeholder = await people.upsertFromTelegram(db, sys, { username: name });
    expect(placeholder.telegramId).toBeNull();
    expect((await people.findByUsername(db, `@${name.toUpperCase()}`))?.id).toBe(placeholder.id);
    const tid = fakeTelegramId();
    const bound = await people.bindTelegramId(db, sys, name, tid);
    expect(bound.id).toBe(placeholder.id);
    expect(bound.telegramId).toBe(tid);
    const log = await audit.listForEntity(db, "person", String(bound.id));
    expect(log.map((r) => r.action)).toEqual(["person.create", "person.bind"]);
  });

  it("merges a placeholder into an existing person with that telegram id, moving their requests", async () => {
    const name = uniqueName("dan");
    const placeholder = await people.upsertFromTelegram(db, sys, { username: name });
    const real = await makePerson(db, { username: null });
    const { request } = await makeRequest(db, { assignee: placeholder });
    const merged = await people.upsertFromTelegram(db, sys, { telegramId: real.telegramId, username: name });
    expect(merged.id).toBe(real.id);
    expect(merged.username).toBe(name);
    expect(await people.getById(db, placeholder.id)).toBeNull();
    const detail = await requests.getDetail(db, sys, request.id);
    expect(detail.request.assigneeId).toBe(real.id);
  });

  it("takes a recycled username off the old account", async () => {
    const name = uniqueName("eve");
    const old = await makePerson(db, { username: name });
    const fresh = await people.upsertFromTelegram(db, sys, { telegramId: fakeTelegramId(), username: name });
    expect(fresh.id).not.toBe(old.id);
    expect((await people.getById(db, old.id))?.username).toBeNull();
  });

  it("keeps an existing username when a text_mention gives none", async () => {
    const p = await makePerson(db);
    const again = await people.upsertFromTelegram(db, sys, { telegramId: p.telegramId, firstName: "New" });
    expect(again.username).toBe(p.username);
  });

  it("setStartedBot flips the flag and audits", async () => {
    const p = await makePerson(db);
    const updated = await people.setStartedBot(db, sys, p.id, true);
    expect(updated.startedBot).toBe(true);
    const log = await audit.listForEntity(db, "person", String(p.id));
    expect(log.at(-1)?.action).toBe("person.started_bot");
  });

  it("superadmin resolves SUPERADMIN_USERNAME to a person (placeholder if unseen)", async () => {
    const admin = await people.superadmin(db, sys);
    expect(admin?.username).toBe("etm_admin_test");
  });
});

describe("verify round 1", () => {
  it("merging a placeholder that a pending prompt points at moves the prompt too", async () => {
    const name = uniqueName("bob");
    const placeholder = await people.upsertFromTelegram(db, sys, { username: name });
    const real = await makePerson(db, { username: null });
    const asker = await makePerson(db);
    const p = await prompts.create(db, actorFor(asker, { via: "telegram" }), {
      chatId: fakeChatId(), promptMessageId: 1, requesterId: placeholder.id, assigneeId: placeholder.id,
    });
    const merged = await people.upsertFromTelegram(db, sys, { telegramId: real.telegramId, username: name });
    expect(merged.id).toBe(real.id);
    expect(await people.getById(db, placeholder.id)).toBeNull();
    const [row] = await db.select().from(pendingPrompts).where(eq(pendingPrompts.id, p.id));
    expect(row).toMatchObject({ requesterId: real.id, assigneeId: real.id });
  });

  it("a web session never moves a username: a stale cookie can't take @foo from its new owner", async () => {
    const foo = uniqueName("foo");
    const alice = await makePerson(db, { username: uniqueName("bar"), startedBot: true });
    const bob = await makePerson(db, { username: foo });
    const { person } = await actorFromSession(db, { telegramId: String(alice.telegramId), username: foo, firstName: "Alice" });
    expect(person.id).toBe(alice.id);
    expect((await people.getById(db, alice.id))?.username).toBe(alice.username);
    expect((await people.getById(db, bob.id))?.username).toBe(foo);
  });

  it("verify round 2: a web visit never flips started_bot back on (only /start does, audited)", async () => {
    const alice = await makePerson(db, { startedBot: false });
    const { person } = await actorFromSession(db, { telegramId: String(alice.telegramId), username: null, firstName: "Alice" });
    expect(person.id).toBe(alice.id);
    expect((await people.getById(db, alice.id))?.startedBot).toBe(false);
  });
});
