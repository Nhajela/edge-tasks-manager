import { describe, expect, it } from "vitest";
import { testDb } from "@tests/helpers/db";
import { actorFor, fakeChatId, makePerson } from "@tests/factories";
import * as audit from "@/services/audit";
import * as prompts from "@/services/prompts";

const db = testDb();

describe("pending mention prompts", () => {
  it("'What should @bob do?' is stored by prompt message id and consumed once by a reply", async () => {
    const alice = await makePerson(db);
    const bob = await makePerson(db);
    const chatId = fakeChatId();
    const actor = actorFor(alice, { via: "telegram" });
    const now = new Date("2026-10-12T10:00:00Z");
    const p = await prompts.create(db, actor, {
      chatId,
      promptMessageId: 77,
      requesterId: alice.id,
      assigneeId: bob.id,
      sourceMessageId: 76,
      now,
    });
    expect(p.expiresAt.getTime()).toBe(now.getTime() + 3600_000);

    const got = await prompts.consume(db, actor, { chatId, promptMessageId: 77, now: new Date(now.getTime() + 60_000) });
    expect(got).toMatchObject({ requesterId: alice.id, assigneeId: bob.id, sourceMessageId: 76 });
    // second reply / Telegram retry: already used
    expect(await prompts.consume(db, actor, { chatId, promptMessageId: 77, now })).toBeNull();
    expect((await audit.listForEntity(db, "prompt", p.id)).map((r) => r.action)).toEqual(["prompt.create", "prompt.consume"]);
  });

  it("expires after an hour and never matches another chat", async () => {
    const alice = await makePerson(db);
    const bob = await makePerson(db);
    const chatId = fakeChatId();
    const actor = actorFor(alice, { via: "telegram" });
    const now = new Date("2026-10-12T10:00:00Z");
    await prompts.create(db, actor, { chatId, promptMessageId: 5, requesterId: alice.id, assigneeId: bob.id, now });
    expect(await prompts.consume(db, actor, { chatId: fakeChatId(), promptMessageId: 5, now })).toBeNull();
    expect(await prompts.consume(db, actor, { chatId, promptMessageId: 5, now: new Date(now.getTime() + 3601_000) })).toBeNull();
  });
});
