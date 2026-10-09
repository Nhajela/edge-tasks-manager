import { describe, expect, it } from "vitest";
import { testDb } from "@tests/helpers/db";
import { actorFor, makePerson, makeRequest } from "@tests/factories";
import { aiActor, systemActor } from "@/lib/actor";
import * as aiContext from "@/services/aiContext";
import * as requests from "@/services/requests";
import { PermissionError } from "@/services/errors";
import { answerQuestion, dismissQuestion } from "@/app/(app)/context/ops";

const db = testDb();

async function asked(text: string) {
  const { request } = await makeRequest(db);
  await requests.setAiState(db, systemActor(), request.id, { aiQuestion: text });
  return request;
}

describe("/context ops", () => {
  it("answers the open question of a request by request id and clears the card", async () => {
    const admin = actorFor(await makePerson(db), { isAdmin: true });
    const request = await asked("Which hall is main?");
    const q = await aiContext.addQuestion(db, aiActor(), { text: "Which hall is main?", requestId: request.id });

    expect(await answerQuestion(db, admin, { requestId: request.id, text: "The dome" })).toEqual({ requestId: request.id });
    const [item] = (await aiContext.list(db, admin, { kind: "question" })).filter((i) => i.id === q.id);
    expect(item).toMatchObject({ status: "answered", answer: "The dome" });
    expect((await requests.getById(db, admin, request.id)).aiQuestion).toBeNull();
  });

  it("answers by question id, and records the question first when only the request has it", async () => {
    const admin = actorFor(await makePerson(db), { isAdmin: true });
    const request = await asked("Is Riva the venue?");
    await answerQuestion(db, admin, { requestId: request.id, question: "Is Riva the venue?", text: "Yes" });
    const items = (await aiContext.list(db, admin, { kind: "question" })).filter((i) => i.requestId === request.id);
    expect(items).toMatchObject([{ text: "Is Riva the venue?", answer: "Yes", status: "answered" }]);

    const q = await aiContext.addQuestion(db, aiActor(), { text: "Loose question" });
    expect(await answerQuestion(db, admin, { questionId: q.id, text: "Ok" })).toEqual({ requestId: null });
  });

  it("dismiss clears the request's question only if it is still the same one", async () => {
    const admin = actorFor(await makePerson(db), { isAdmin: true });
    const request = await asked("Old?");
    const q = await aiContext.addQuestion(db, aiActor(), { text: "Old?", requestId: request.id });
    await requests.setAiState(db, systemActor(), request.id, { aiQuestion: "Newer?" });
    await dismissQuestion(db, admin, q.id);
    expect((await requests.getById(db, admin, request.id)).aiQuestion).toBe("Newer?");

    const q2 = await aiContext.addQuestion(db, aiActor(), { text: "Newer?", requestId: request.id });
    await dismissQuestion(db, admin, q2.id);
    expect((await requests.getById(db, admin, request.id)).aiQuestion).toBeNull();
  });

  it("is admin only", async () => {
    const request = await asked("Who?");
    const someone = actorFor(await makePerson(db));
    await expect(answerQuestion(db, someone, { requestId: request.id, question: "Who?", text: "Me" })).rejects.toThrow(PermissionError);
  });
});
