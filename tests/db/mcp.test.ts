import { McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";
import { testDb } from "@tests/helpers/db";
import { actorFor, makePerson, makeRequest } from "@tests/factories";
import { actorFromToken } from "@/lib/actor";
import { createMcpServer } from "@/lib/mcp/server";
import * as audit from "@/services/audit";
import * as tokens from "@/services/tokens";
import * as requests from "@/services/requests";
import { attachments } from "@/db/schema";
import type { Effect } from "@/services/types";
import type { Person } from "@/lib/types";

// after() needs a Next request scope; run its callback inline so the route test sees effects scheduled
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void fn() }));
vi.mock("@/lib/effects", () => ({ runEffects: vi.fn(async () => {}) }));

const db = testDb();
const LEGACY = "2025-11-25";

async function rpc(server: McpServer, method: string, params: Record<string, unknown> = {}) {
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const res = await transport.handleRequest(
    new Request("http://mcp.test/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": LEGACY },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  await server.close();
  return res.json();
}

/** One tool call as `person`; returns the structured result plus the effects it scheduled. */
async function call(person: Person, name: string, args: Record<string, unknown> = {}) {
  const scheduled: Effect[] = [];
  const server = createMcpServer(actorFromToken(person), { db, schedule: (e) => void scheduled.push(...e) });
  const json = await rpc(server, "tools/call", { name, arguments: args });
  const r = json.result;
  return { r, data: r?.structuredContent, text: r?.content?.[0]?.text as string, isError: Boolean(r?.isError), scheduled };
}

describe("mcp server", () => {
  it("lists every tool with descriptions, and states the model in its instructions", async () => {
    const me = await makePerson(db);
    const server = createMcpServer(actorFromToken(me), { db });
    const init = await rpc(server, "initialize", { protocolVersion: LEGACY, capabilities: {}, clientInfo: { name: "t", version: "1" } });
    expect(init.result.instructions).toMatch(/request/i);
    const list = await rpc(createMcpServer(actorFromToken(me), { db }), "tools/list");
    const names = list.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(
      ["add_comment", "create_request", "get_request", "list_requests", "set_due", "set_priority", "update_status", "whoami"].sort(),
    );
    for (const t of list.result.tools) expect(t.description.length).toBeGreaterThan(30);
    const get = list.result.tools.find((t: { name: string }) => t.name === "get_request");
    expect(get.description).toMatch(/public URL/i);
  });

  it("whoami returns the token's person and open counts", async () => {
    const me = await makePerson(db, { firstName: "Asha" });
    await makeRequest(db, { assignee: me });
    const { data } = await call(me, "whoami");
    expect(data).toMatchObject({ id: me.id, username: me.username, isAdmin: false, open: { inbox: 1, raised: 0 } });
  });

  type G = { key: string; title: string; count: number; items: { id: number }[] };
  const ids = (data: { groups: G[] }) => data.groups.flatMap((g) => g.items.map((i) => i.id));

  it("list_requests: inbox by default, raised, status and person filters, admin-only all", async () => {
    const me = await makePerson(db);
    const bob = await makePerson(db);
    const carol = await makePerson(db);
    const a = await makeRequest(db, { assignee: me, requester: bob, body: "bring chairs to the deck" });
    const b = await makeRequest(db, { assignee: me, requester: carol });
    await makeRequest(db, { requester: me, assignee: bob });
    await requests.setStatus(db, actorFor(me), b.request.id, { status: "done", note: "chairs are on the deck" });

    let res = await call(me, "list_requests");
    expect(res.data.box).toBe("inbox");
    expect(res.data.groups).toEqual([expect.objectContaining({ key: "new", title: "New", count: 1 })]);
    expect(res.data.groups[0].items[0]).toMatchObject({ id: a.request.id, requester: `@${bob.username}`, status: "open", url: expect.stringContaining(`/r/${a.request.id}`) });
    expect(res.data.counts).toEqual({ open: 1, done: 1, all: 2 });

    res = await call(me, "list_requests", { status: "done" });
    expect(res.data.groups.map((g: G) => g.key)).toEqual(["done"]);
    expect(res.data.groups[0].items[0]).toMatchObject({ id: b.request.id, resultNote: "chairs are on the deck" });
    res = await call(me, "list_requests", { status: "all", person: `@${carol.username}` });
    expect(ids(res.data)).toEqual([b.request.id]);
    res = await call(me, "list_requests", { box: "raised" });
    expect(res.data.groups.map((g: G) => [g.key, g.count])).toEqual([["active", 1]]);

    res = await call(me, "list_requests", { box: "all" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/PERMISSION_DENIED/);
  });

  it("list_requests: grouped in the fixed bucket order, limit caps each group; admins' all box is per assignee", async () => {
    const me = await makePerson(db);
    const now = Date.now();
    const seen = await makeRequest(db, { assignee: me });
    await requests.markSeen(db, actorFor(me), seen.request.id);
    const fresh = [await makeRequest(db, { assignee: me }), await makeRequest(db, { assignee: me })];
    const later = await makeRequest(db, { assignee: me });
    await requests.markSeen(db, actorFor(me), later.request.id);
    await requests.setDue(db, actorFor(me), later.request.id, new Date(now + 6 * 86400_000));

    let res = await call(me, "list_requests", { limit: 1 });
    expect(res.data.groups.map((g: G) => [g.key, g.count, g.items.length])).toEqual([
      ["new", 2, 1],
      ["act", 1, 1],
      ["upcoming", 1, 1],
    ]);
    expect(res.data.groups[0].items[0].id).toBe(fresh[0].request.id); // oldest first

    const late = await makeRequest(db, { requester: me });
    await requests.setDue(db, actorFor(me), late.request.id, new Date(now - 86400_000));
    res = await call(me, "list_requests", { box: "raised" });
    expect(res.data.groups[0]).toMatchObject({ key: "overdue", title: "Overdue", count: 1 });

    const admin = await makePerson(db);
    const scheduled: Effect[] = [];
    const server = createMcpServer({ ...actorFromToken(admin), isAdmin: true }, { db, schedule: (e) => void scheduled.push(...e) });
    const json = await rpc(server, "tools/call", { name: "list_requests", arguments: { box: "all", person: `@${me.username}` } });
    const groups: (G & { person: { username: string } })[] = json.result.structuredContent.groups;
    const mine = groups.find((g) => g.key === `person:${me.id}`)!;
    expect(mine).toMatchObject({ title: `@${me.username}`, count: 4, person: { username: me.username } });
    expect(groups.find((g) => g.key === `person:${late.assignee.id}`)!.items.map((i) => i.id)).toEqual([late.request.id]);
  });

  it("get_request puts the delivered result first: note, who, when, the message and its files", async () => {
    const { request, assignee, requester } = await makeRequest(db);
    await requests.setStatus(db, actorFor(requester), request.id, {
      status: "done",
      note: "projector fixed",
      message: {
        chatId: request.chatId!,
        messageId: 902,
        fromId: requester.id,
        text: "/done projector fixed",
        attachments: [{ messageId: 902, telegramFileId: "FILE_R", telegramFileUniqueId: `UR${request.id}`, kind: "photo" }],
      },
    });
    const { data } = await call(assignee, "get_request", { id: request.id });
    expect(Object.keys(data)[0]).toBe("result");
    expect(data.result).toMatchObject({
      note: "projector fixed",
      by: `@${requester.username}`,
      at: expect.any(String),
      message: { kind: "status", text: "/done projector fixed" },
      attachments: [{ kind: "photo", url: expect.stringMatching(/\/api\/files\/\d+\?sig=/) }],
    });
    expect(data.messages.map((m: { kind: string }) => m.kind)).toEqual(["original", "status"]);

    const open = await makeRequest(db);
    expect((await call(open.assignee, "get_request", { id: open.request.id })).data.result).toBeNull();
  });

  it("get_request returns body, messages with links, signed absolute attachment URLs, timeline and people", async () => {
    const me = await makePerson(db);
    const { request, requester } = await makeRequest(db, { assignee: me, body: "projector is broken" });
    await db.insert(attachments).values({ requestId: request.id, telegramFileId: "f1", telegramFileUniqueId: `u${request.id}`, kind: "photo", mime: "image/jpeg" });
    await requests.comment(db, actorFor(requester), request.id, { text: "any update?", notify: false });

    const { data } = await call(me, "get_request", { id: request.id });
    expect(data).toMatchObject({ id: request.id, body: "projector is broken", status: "open", aiQuestion: null });
    expect(data.people).toMatchObject({ requester: { username: requester.username }, assignee: { username: me.username } });
    expect(data.messages[0]).toMatchObject({ kind: "original", text: "projector is broken", from: `@${requester.username}` });
    expect(data.attachments[0].url).toMatch(/^https?:\/\/[^/]+\/api\/files\/\d+\?sig=[\w-]+$/);
    expect(data.timeline.map((t: { action: string }) => t.action)).toEqual(["request.create", "request.comment"]);
    expect(data.timeline[1].summary).toBe("any update?");

    const stranger = await makePerson(db);
    const denied = await call(stranger, "get_request", { id: request.id });
    expect(denied.isError).toBe(true);
    expect(denied.text).toMatch(/PERMISSION_DENIED/);
    const missing = await call(me, "get_request", { id: 2_000_000_000 });
    expect(missing.text).toMatch(/NOT_FOUND/);
  });

  it("create_request raises one as the token's person, creating a placeholder assignee, and schedules effects", async () => {
    const me = await makePerson(db);
    const newbie = `newbie_${me.id}`;
    const res = await call(me, "create_request", { assignee: `@${newbie}`, text: "order 20 coconuts for Friday", priority: "high" });
    expect(res.isError).toBe(false);
    const r = await requests.getById(db, actorFor(me), res.data.id);
    expect(r).toMatchObject({ requesterId: me.id, createdById: me.id, priority: "high", body: "order 20 coconuts for Friday" });
    expect(res.data.assignee).toBe(`@${newbie}`);
    expect(res.scheduled.map((e) => e.kind)).toContain("title");
    const log = await audit.listForEntity(db, "request", r.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: "request.create", via: "mcp", actorKind: "mcp" });
  });

  it("update_status, add_comment, set_due, set_priority each write one audit row via mcp", async () => {
    const me = await makePerson(db);
    const requester = await makePerson(db, { startedBot: true });
    const { request } = await makeRequest(db, { assignee: me, requester });
    const id = request.id;

    let res = await call(me, "update_status", { id, status: "in_progress", custom_label: "ordering from Panjim", note: "on it" });
    expect(res.data).toMatchObject({ status: "in_progress", customStatus: "ordering from Panjim" });
    res = await call(me, "add_comment", { id, text: "arrives tomorrow" });
    expect(res.scheduled.some((e) => e.kind === "notify")).toBe(true);
    res = await call(me, "add_comment", { id, text: "quiet note", notify: false });
    expect(res.scheduled).toEqual([]);
    res = await call(me, "set_due", { id, due: "2026-10-15" });
    expect(res.data.dueAt).toBe("2026-10-15T18:29:00.000Z"); // date only = end of that IST day
    res = await call(me, "set_due", { id, due: null });
    expect(res.data.dueAt).toBeNull();
    res = await call(me, "set_priority", { id, priority: "urgent" });
    expect(res.data.priority).toBe("urgent");
    res = await call(me, "set_due", { id, due: "not a date" });
    expect(res.text).toMatch(/VALIDATION_FAILED/);

    const log = await audit.listForEntity(db, "request", id);
    expect(log.map((l) => l.action)).toEqual([
      "request.create",
      "request.status",
      "request.comment",
      "request.comment",
      "request.due",
      "request.due",
      "request.priority",
    ]);
    expect(log.slice(1).every((l) => l.via === "mcp")).toBe(true);
  });

  it("update_status records result_note and result_message_id (a request_messages id from get_request)", async () => {
    const me = await makePerson(db);
    const { request } = await makeRequest(db, { assignee: me });
    const [orig] = (await call(me, "get_request", { id: request.id })).data.messages;
    expect(orig.id).toEqual(expect.any(Number));
    const res = await call(me, "update_status", { id: request.id, status: "done", result_note: "invoice sent", result_message_id: orig.id });
    expect(res.data).toMatchObject({ status: "done", resultNote: "invoice sent" });
    expect((await requests.getById(db, actorFor(me), request.id)).resultMessageId).toBe(orig.id);
  });

  it("update_status rejects an unknown status before calling the service", async () => {
    const me = await makePerson(db);
    const { request } = await makeRequest(db, { assignee: me });
    const res = await call(me, "update_status", { id: request.id, status: "finished" });
    expect(JSON.stringify(res.r)).toMatch(/status/i);
    expect((await requests.getById(db, actorFor(me), request.id)).status).toBe("open");
  });
});

describe("/api/mcp route", () => {
  const post = async (headers: Record<string, string>, body: unknown) => {
    const { POST } = await import("@/app/api/mcp/route");
    return POST(
      new Request("http://mcp.test/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
        body: JSON.stringify(body),
      }),
    );
  };

  it("401s without a valid etm_ token", async () => {
    expect((await post({}, { jsonrpc: "2.0", id: 1, method: "tools/list" })).status).toBe(401);
    const bad = await post({ authorization: "Bearer etm_nope" }, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(bad.status).toBe(401);
    expect(bad.headers.get("www-authenticate")).toMatch(/^Bearer/);
  });

  it("serves a 2025-11-25 client with a Bearer token: initialize, then whoami", async () => {
    const me = await makePerson(db);
    const { token } = await tokens.create(db, actorFor(me), { name: "test" });
    const h = { authorization: `Bearer ${token}`, "mcp-protocol-version": LEGACY };
    const init = await post(h, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: LEGACY, capabilities: {}, clientInfo: { name: "t", version: "1" } },
    });
    expect(init.status).toBe(200);
    expect((await init.json()).result.protocolVersion).toBe(LEGACY);
    const who = await post(h, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "whoami", arguments: {} } });
    expect((await who.json()).result.structuredContent).toMatchObject({ id: me.id });
  });

  it("refuses GET", async () => {
    const { GET } = await import("@/app/api/mcp/route");
    expect(GET().status).toBe(405);
  });
});
