import { describe, expect, it } from "vitest";
import { testDb } from "@tests/helpers/db";
import { fakeTelegramId, makePerson, makeRequest, uniqueName } from "@tests/factories";
import { systemActor } from "@/lib/actor";
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
