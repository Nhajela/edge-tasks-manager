import { describe, expect, it } from "vitest";
import { testDb } from "@tests/helpers/db";
import { actorFor, makePerson, makeRequest, uniqueName } from "@tests/factories";
import { aiActor } from "@/lib/actor";
import * as aiContext from "@/services/aiContext";
import * as audit from "@/services/audit";
import { PermissionError } from "@/services/errors";

const db = testDb();

describe("aiContext", () => {
  it("admins manage facts; the AI asks questions; admins answer; prompt items are facts + answers", async () => {
    const admin = actorFor(await makePerson(db), { isAdmin: true });
    const fact = await aiContext.addFact(db, admin, uniqueName("Main hall is the Riva dome"));
    const edited = await aiContext.updateFact(db, admin, fact.id, "Main hall = the dome");
    expect(edited.text).toBe("Main hall = the dome");

    const { request } = await makeRequest(db);
    const q = await aiContext.addQuestion(db, aiActor(), { text: "Which hall is main?", requestId: request.id });
    expect(q).toMatchObject({ kind: "question", status: "open", requestId: request.id });
    expect((await aiContext.list(db, admin, { kind: "question", status: "open" })).map((i) => i.id)).toContain(q.id);

    const answered = await aiContext.answer(db, admin, q.id, "The dome");
    expect(answered).toMatchObject({ status: "answered", answer: "The dome" });

    const items = await aiContext.promptItems(db);
    expect(items.map((i) => i.id)).toEqual(expect.arrayContaining([fact.id, q.id]));

    const q2 = await aiContext.addQuestion(db, aiActor(), { text: "Dismiss me" });
    await aiContext.dismiss(db, admin, q2.id);
    await aiContext.remove(db, admin, fact.id);
    const after = (await aiContext.promptItems(db)).map((i) => i.id);
    expect(after).not.toContain(fact.id);
    expect(after).not.toContain(q2.id);

    expect((await audit.listForEntity(db, "ai_context", String(q.id))).map((r) => r.action)).toEqual([
      "ai_context.question",
      "ai_context.answer",
    ]);
  });

  it("non-admins cannot edit the context", async () => {
    const someone = actorFor(await makePerson(db));
    await expect(aiContext.addFact(db, someone, "x")).rejects.toBeInstanceOf(PermissionError);
  });
});
