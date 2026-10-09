import { describe, expect, it } from "vitest";
import { testDb } from "@tests/helpers/db";
import { actorFor, fakeChatId, makePerson, makeRequest } from "@tests/factories";
import { PermissionError } from "@/services/errors";
import * as audit from "@/services/audit";
import * as requests from "@/services/requests";

const db = testDb();

describe("admin reads", () => {
  it("listAll filters by chat, and counts follow the filter", async () => {
    const admin = actorFor(await makePerson(db), { isAdmin: true });
    const chatId = fakeChatId();
    const a = await makeRequest(db, { chatId });
    await makeRequest(db, { chatId, requester: a.requester });
    await makeRequest(db, { requester: a.requester }); // another chat
    const res = await requests.listAll(db, admin, { chatId, status: "all" });
    expect(res.items.map((i) => i.chatId)).toEqual([chatId, chatId]);
    expect(res.counts).toEqual({ open: 2, done: 0, all: 2 });
    const both = await requests.listAll(db, admin, { chatId, personId: a.requester.id, status: "all" });
    expect(both.items).toHaveLength(2);
  });

  it("adminFacets lists people on requests and chats with counts; admins only", async () => {
    const me = await makePerson(db);
    const chatId = fakeChatId();
    const r = await makeRequest(db, { chatId });
    await makeRequest(db, { chatId, requester: r.requester });
    await expect(requests.adminFacets(db, actorFor(me))).rejects.toBeInstanceOf(PermissionError);
    const f = await requests.adminFacets(db, actorFor(me, { isAdmin: true }));
    expect(f.chats).toContainEqual({ chatId, chatTitle: "Test group", count: 2 });
    const ids = f.people.map((p) => p.id);
    expect(ids).toContain(r.requester.id);
    expect(ids).toContain(r.assignee.id);
    expect(ids).not.toContain(me.id);
  });

  it("audit.facets lists each action once and the people who acted", async () => {
    const r = await makeRequest(db);
    const f = await audit.facets(db);
    expect(f.actions).toContain("request.create");
    expect(new Set(f.actions).size).toBe(f.actions.length);
    expect(f.actors).toContainEqual({ personId: r.requester.id, label: `@${r.requester.username}` });
    expect(new Set(f.actors.map((a) => a.personId)).size).toBe(f.actors.length);
  });
});
