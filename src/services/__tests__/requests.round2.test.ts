import { describe, expect, it } from "vitest";
import { testDb } from "@tests/helpers/db";
import { actorFor, makePerson, makeRequest } from "@tests/factories";
import { systemActor } from "@/lib/actor";
import { PermissionError, ValidationError } from "@/services/errors";
import * as requests from "@/services/requests";
import type { Effect } from "@/services/types";

const db = testDb();
const notes = (effects: Effect[]) => effects.flatMap((e) => (e.kind === "notify" ? [e.message] : []));
const actions = async (id: number) => (await requests.getDetail(db, systemActor(), id)).timeline.map((t) => t.action);

describe("setStatus: in-thread status messages and the deliverable", () => {
  it("stores the command message as kind 'status', excluded from the thread count, still a chain target", async () => {
    const { request, assignee } = await makeRequest(db);
    const chatId = request.chatId!;
    const res = await requests.setStatus(db, actorFor(assignee, { via: "telegram" }), request.id, {
      status: "done",
      note: "projector fixed",
      message: { chatId, messageId: 900, fromId: assignee.id, text: "/done projector fixed" },
    });
    const d = await requests.getDetail(db, systemActor(), request.id);
    expect(d.messages.map((m) => m.kind)).toEqual(["original", "status"]);
    expect(await requests.findRequestByTelegramMessage(db, chatId, 900)).toBe(request.id);
    const [item] = (await requests.listInbox(db, actorFor(assignee), { status: "all" })).items.filter((i) => i.id === request.id);
    expect(item.threadCount).toBe(0);
    // the done note is the result note; the command message carries no media so it is not the result message
    expect(res.request).toMatchObject({ resultNote: "projector fixed", resultMessageId: null, resultById: assignee.id });
    expect(res.request.resultAt).toBeInstanceOf(Date);
  });

  it("a done command with media makes that message the result; requester's notification carries note + first photo", async () => {
    const requester = await makePerson(db, { startedBot: true });
    const { request, assignee } = await makeRequest(db, { requester });
    const res = await requests.setStatus(db, actorFor(assignee, { via: "telegram" }), request.id, {
      status: "done",
      note: "here it is",
      message: {
        chatId: request.chatId!,
        messageId: 901,
        fromId: assignee.id,
        text: "/done here it is",
        attachments: [{ messageId: 901, telegramFileId: "FILE_A", telegramFileUniqueId: "UA", kind: "photo" }],
      },
    });
    const d = await requests.getDetail(db, systemActor(), request.id);
    expect(res.request.resultMessageId).toBe(d.messages[1].id);
    const [n] = notes(res.effects);
    expect(n).toMatchObject({ chatId: requester.telegramId, photo: { fileId: "FILE_A" } });
    expect(n.html).toContain("here it is");
  });

  it("explicit result.messageId must be a message of this request; reopen clears the highlight but keeps history", async () => {
    const { request, assignee, requester } = await makeRequest(db);
    const other = await makeRequest(db);
    const [otherMsg] = (await requests.getDetail(db, systemActor(), other.request.id)).messages;
    await expect(
      requests.setStatus(db, actorFor(assignee), request.id, { status: "done", result: { messageId: otherMsg.id } }),
    ).rejects.toBeInstanceOf(ValidationError);
    const [orig] = (await requests.getDetail(db, systemActor(), request.id)).messages;
    const done = await requests.setStatus(db, actorFor(assignee), request.id, { status: "done", result: { note: "slides", messageId: orig.id } });
    expect(done.request).toMatchObject({ resultNote: "slides", resultMessageId: orig.id });
    const reopened = await requests.setStatus(db, actorFor(requester), request.id, { status: "open" });
    expect(reopened.request).toMatchObject({ resultNote: null, resultMessageId: null, resultById: null, resultAt: null });
    const d = await requests.getDetail(db, systemActor(), request.id);
    const doneRow = d.timeline.find((t) => t.action === "request.status" && t.data?.to === "done");
    expect(doneRow?.data?.result).toMatchObject({ note: "slides", messageId: orig.id });
  });

  it("closing on someone's behalf: audit says onBehalfOf, the assignee is told, not the actor", async () => {
    const assignee = await makePerson(db, { startedBot: true });
    const requester = await makePerson(db, { startedBot: true });
    const { request } = await makeRequest(db, { requester, assignee });
    const res = await requests.setStatus(db, actorFor(requester), request.id, { status: "done", note: "she delivered" });
    const row = (await requests.getDetail(db, systemActor(), request.id)).timeline.at(-1)!;
    expect(row.data).toMatchObject({ onBehalfOf: assignee.id });
    expect(notes(res.effects).map((m) => m.chatId)).toEqual([assignee.telegramId]);

    // an admin closing: still the assignee who hears about it
    const admin = await makePerson(db, { startedBot: true });
    const r2 = await makeRequest(db, { requester, assignee });
    const byAdmin = await requests.setStatus(db, actorFor(admin, { isAdmin: true }), r2.request.id, { status: "declined" });
    expect(notes(byAdmin.effects).map((m) => m.chatId)).toEqual([assignee.telegramId]);

    // the assignee's own status change has no onBehalfOf
    const r3 = await makeRequest(db, { requester, assignee });
    await requests.setStatus(db, actorFor(assignee), r3.request.id, { status: "done" });
    const own = (await requests.getDetail(db, systemActor(), r3.request.id)).timeline.at(-1)!;
    expect(own.data).not.toHaveProperty("onBehalfOf");
  });
});

describe("markDeliverable", () => {
  it("assignee/requester/admin pick a message of the request; one audit row", async () => {
    const { request, assignee } = await makeRequest(db);
    const [orig] = (await requests.getDetail(db, systemActor(), request.id)).messages;
    const res = await requests.markDeliverable(db, actorFor(assignee), request.id, orig.id);
    expect(res.request).toMatchObject({ resultMessageId: orig.id, resultById: assignee.id });
    expect((await actions(request.id)).filter((a) => a === "request.deliverable")).toHaveLength(1);

    const stranger = await makePerson(db);
    await expect(requests.markDeliverable(db, actorFor(stranger), request.id, orig.id)).rejects.toBeInstanceOf(PermissionError);
    const other = await makeRequest(db);
    const [otherMsg] = (await requests.getDetail(db, systemActor(), other.request.id)).messages;
    await expect(requests.markDeliverable(db, actorFor(assignee), request.id, otherMsg.id)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("markSeen", () => {
  it("sets assignee_seen_at once with one audit row; later calls and non-assignees are no-ops", async () => {
    const { request, assignee, requester } = await makeRequest(db);
    expect((await requests.markSeen(db, actorFor(requester), request.id)).changed).toBe(false);
    const first = await requests.markSeen(db, actorFor(assignee), request.id);
    expect(first.changed).toBe(true);
    expect(first.request.assigneeSeenAt).toBeInstanceOf(Date);
    expect((await requests.markSeen(db, actorFor(assignee), request.id)).changed).toBe(false);
    expect((await actions(request.id)).filter((a) => a === "request.seen")).toHaveLength(1);
  });
});

describe("lists carry what grouping needs", () => {
  it("seen_at, result note, chat title, counts; closedSince limits only closed items", async () => {
    const me = await makePerson(db);
    const open = await makeRequest(db, { assignee: me });
    const done = await makeRequest(db, { assignee: me });
    await requests.setStatus(db, actorFor(me), done.request.id, { status: "done", note: "ok" });
    await requests.markSeen(db, actorFor(me), open.request.id);
    const all = await requests.listInbox(db, actorFor(me), { status: "all" });
    expect(all.items.find((i) => i.id === done.request.id)).toMatchObject({ resultNote: "ok", chatTitle: "Test group", attachmentCount: 0, threadCount: 0 });
    expect(all.items.find((i) => i.id === open.request.id)?.assigneeSeenAt).toBeInstanceOf(Date);
    const recent = await requests.listInbox(db, actorFor(me), { status: "all", closedSince: new Date(Date.now() + 60_000) });
    expect(recent.items.map((i) => i.id)).toEqual([open.request.id]);
  });
});
