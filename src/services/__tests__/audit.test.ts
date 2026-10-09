import { describe, expect, it } from "vitest";
import { testDb } from "@tests/helpers/db";
import { actorFor, makePerson, uniqueName } from "@tests/factories";
import { aiActor, systemActor } from "@/lib/actor";
import * as audit from "@/services/audit";

const db = testDb();

describe("audit", () => {
  it("records a row with the actor snapshot and reads it back per entity", async () => {
    const p = await makePerson(db, { firstName: "Asha" });
    const entityId = uniqueName("e");
    await audit.record(db, actorFor(p, { via: "telegram" }), {
      action: "request.comment",
      entityType: "test",
      entityId,
      summary: "hello",
      data: { notify: true },
    });
    await audit.record(db, aiActor(), { action: "request.title", entityType: "test", entityId, summary: "AI title" });
    const rows = await audit.listForEntity(db, "test", entityId);
    expect(rows.map((r) => r.action)).toEqual(["request.comment", "request.title"]);
    expect(rows[0]).toMatchObject({
      actorKind: "person",
      actorPersonId: p.id,
      actorLabel: `@${p.username}`,
      via: "telegram",
      summary: "hello",
      data: { notify: true },
    });
    expect(rows[1]).toMatchObject({ actorKind: "ai", actorPersonId: null, via: "ai" });
  });

  it("lists recent entries newest first with a limit and optional filters", async () => {
    const entityId = uniqueName("e");
    for (const a of ["x.one", "x.two", "x.three"])
      await audit.record(db, systemActor(), { action: a, entityType: "test", entityId });
    const recent = await audit.listRecent(db, { limit: 2, entityType: "test", entityId });
    expect(recent.map((r) => r.action)).toEqual(["x.three", "x.two"]);
    const before = await audit.listRecent(db, { limit: 5, entityType: "test", entityId, beforeId: recent[1].id });
    expect(before.map((r) => r.action)).toEqual(["x.one"]);
  });
});
