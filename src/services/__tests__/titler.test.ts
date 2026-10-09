import { describe, expect, it, vi } from "vitest";
import { testDb } from "@tests/helpers/db";
import { actorFor, makeRequest } from "@tests/factories";
import { aiActor } from "@/lib/actor";
import * as aiContext from "@/services/aiContext";
import * as requests from "@/services/requests";
import { titleRequest } from "@/services/titler";

const db = testDb();
const now = () => new Date("2026-10-09T06:30:00Z"); // Fri 9 Oct, 12:00 IST

const aiFetch = (out: unknown) =>
  vi.fn<typeof fetch>(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }] })),
  );
const OUT = { title: "Get 20 extension cords for hackathon", priority: "high", due_at: "2026-10-09T21:00", question: "Which hackathon venue?" };

describe("titleRequest", () => {
  it("without a key marks the request skipped and makes no call", async () => {
    const { request } = await makeRequest(db);
    const fetch = aiFetch(OUT);
    await titleRequest(db, request.id, { apiKey: null, fetch, now });
    expect(fetch).not.toHaveBeenCalled();
    expect((await requests.getById(db, aiActor(), request.id)).aiStatus).toBe("skipped");
  });

  it("writes title/priority/due, stores the question, and edits the bot confirmation", async () => {
    const { request, assignee } = await makeRequest(db, { body: "20 extension cords for the hackathon tonight pls" });
    await requests.setBotConfirmation(db, aiActor(), request.id, { chatId: request.chatId!, messageId: 777 });
    const tg = vi.fn(async () => ({ ok: true }));
    const fetch = aiFetch(OUT);
    await titleRequest(db, request.id, { apiKey: "k", model: "m", fetch, now, tg });

    const sent = JSON.parse(fetch.mock.calls[0][1]!.body as string);
    expect(sent.messages.map((m: { content: string }) => m.content).join("\n")).toContain("20 extension cords");

    const r = await requests.getById(db, aiActor(), request.id);
    expect(r).toMatchObject({ title: OUT.title, priority: "high", aiStatus: "done", aiQuestion: OUT.question, titleLocked: false });
    expect(r.dueAt?.toISOString()).toBe("2026-10-09T15:30:00.000Z");

    const admin = actorFor(assignee, { isAdmin: true });
    const qs = await aiContext.list(db, admin, { kind: "question", status: "open" });
    expect(qs.find((q) => q.requestId === request.id)?.text).toBe(OUT.question);

    expect(tg).toHaveBeenCalledWith("editMessageText", expect.objectContaining({ chat_id: request.chatId, message_id: 777 }));
    const edit = (tg.mock.calls[0] as unknown[])[1] as { text: string; reply_markup: unknown };
    expect(edit.text).toContain(`#${request.id}`);
    expect(edit.text).toContain(OUT.title);
    expect(edit.reply_markup).toBeTruthy();
  });

  it("respects human locks and skips the edit when the title did not change", async () => {
    const { request, requester } = await makeRequest(db);
    const human = actorFor(requester);
    await requests.setTitle(db, human, request.id, "Fix the projector");
    await requests.setPriority(db, human, request.id, "low");
    await requests.setBotConfirmation(db, aiActor(), request.id, { chatId: request.chatId!, messageId: 778 });
    const tg = vi.fn(async () => ({ ok: true }));
    await titleRequest(db, request.id, { apiKey: "k", model: "m", fetch: aiFetch({ ...OUT, question: null }), now, tg });

    const r = await requests.getById(db, aiActor(), request.id);
    expect(r).toMatchObject({ title: "Fix the projector", priority: "low", aiStatus: "done", aiQuestion: null });
    expect(r.dueAt?.toISOString()).toBe("2026-10-09T15:30:00.000Z"); // due was not locked
    expect(tg).not.toHaveBeenCalled();
  });

  it("on failure marks ai_status failed and keeps the heuristic title", async () => {
    const { request } = await makeRequest(db);
    const fetch = vi.fn(async () => new Response("nope", { status: 500 }));
    await titleRequest(db, request.id, { apiKey: "k", model: "m", fetch, now });
    const r = await requests.getById(db, aiActor(), request.id);
    expect(r.aiStatus).toBe("failed");
    expect(r.title).toBe(request.title);
  });

  it("clips a rambling model question instead of failing the run", async () => {
    const { request } = await makeRequest(db);
    await titleRequest(db, request.id, { apiKey: "k", model: "m", fetch: aiFetch({ ...OUT, question: "why ".repeat(2000) }), now, tg: async () => ({}) });
    const r = await requests.getById(db, aiActor(), request.id);
    expect(r.aiStatus).toBe("done");
    expect(r.aiQuestion!.length).toBeLessThanOrEqual(500);
  });

  it("a failed write after the model answered marks ai_status failed, not pending forever", async () => {
    const { request } = await makeRequest(db);
    let inserts = 0;
    const flaky = new Proxy(db, {
      get(t, p) {
        const v = Reflect.get(t, p);
        if (p === "insert" && inserts++ === 0) return () => { throw new Error("db blip"); };
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    await titleRequest(flaky, request.id, { apiKey: "k", model: "m", fetch: aiFetch(OUT), now, tg: async () => ({}) });
    expect((await requests.getById(db, aiActor(), request.id)).aiStatus).toBe("failed");
  });
});
