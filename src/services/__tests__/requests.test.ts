import { describe, expect, it } from "vitest";
import { testDb } from "@tests/helpers/db";
import { actorFor, fakeChatId, makePerson, makeRequest } from "@tests/factories";
import { aiActor, systemActor } from "@/lib/actor";
import { NotFoundError, PermissionError, ValidationError } from "@/services/errors";
import * as botMessages from "@/services/botMessages";
import * as requests from "@/services/requests";

const db = testDb();

describe("requests.create", () => {
  it("creates with a heuristic title, original messages, attachments, one audit row and effects", async () => {
    const requester = await makePerson(db);
    const assignee = await makePerson(db, { startedBot: true });
    const chatId = fakeChatId();
    const res = await requests.create(db, actorFor(requester, { via: "telegram" }), {
      requesterId: requester.id,
      assigneeId: assignee.id,
      body: "Can someone please get 20 extra chairs to the main hall before the talk tonight",
      chatId,
      chatTitle: "Volunteers",
      sourceMessageId: 500,
      messageLink: "https://t.me/c/123/500",
      messages: [{ messageId: 500, fromId: requester.id, text: "Can someone please get 20 extra chairs", link: "https://t.me/c/123/500" }],
      attachments: [{ messageId: 500, telegramFileId: "f1", telegramFileUniqueId: "u1", kind: "photo", width: 10, height: 10 }],
    });
    expect(res.duplicate).toBe(false);
    expect(res.request).toMatchObject({ status: "open", priority: "normal", aiStatus: "pending", chatId, createdById: requester.id });
    expect(res.request.title.length).toBeGreaterThan(5);
    const detail = await requests.getDetail(db, actorFor(assignee), res.request.id);
    expect(detail.messages).toHaveLength(1);
    expect(detail.messages[0]).toMatchObject({ kind: "original", messageId: 500 });
    expect(detail.attachments).toHaveLength(1);
    expect(detail.timeline.map((t) => t.action)).toEqual(["request.create"]);
    expect(res.effects).toContainEqual({ kind: "title", requestId: res.request.id });
    const notify = res.effects.filter((e) => e.kind === "notify");
    expect(notify).toHaveLength(1);
    expect(notify[0]).toMatchObject({ message: { chatId: assignee.telegramId, kind: "assigned" } });
  });

  it("dedupes a Telegram retry by (chat, message)", async () => {
    const first = await makeRequest(db, { messageId: 777 });
    const again = await requests.create(db, actorFor(first.requester, { via: "telegram" }), {
      requesterId: first.requester.id,
      assigneeId: first.assignee.id,
      body: "x",
      chatId: first.request.chatId,
      messages: [{ messageId: 777, fromId: first.requester.id, text: "x" }],
    });
    expect(again.duplicate).toBe(true);
    expect(again.request.id).toBe(first.request.id);
    expect(again.effects).toEqual([]);
  });

  it("does not DM the assignee about their own request or when they never started the bot", async () => {
    const me = await makePerson(db, { startedBot: true });
    const self = await makeRequest(db, { requester: me, assignee: me });
    expect(self.effects.filter((e) => e.kind === "notify")).toEqual([]);
    const quiet = await makeRequest(db, { assignee: await makePerson(db, { startedBot: false }) });
    expect(quiet.effects.filter((e) => e.kind === "notify")).toEqual([]);
  });

  it("validates the body", async () => {
    const p = await makePerson(db);
    await expect(requests.create(db, actorFor(p), { requesterId: p.id, assigneeId: p.id, body: "   " })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("a person cannot raise a request on someone else's behalf from the web", async () => {
    const [a, b, c] = await Promise.all([makePerson(db), makePerson(db), makePerson(db)]);
    await expect(requests.create(db, actorFor(a), { requesterId: b.id, assigneeId: c.id, body: "x" })).rejects.toBeInstanceOf(
      PermissionError,
    );
  });
});

describe("append, thread and message lookup", () => {
  it("append adds to the body, stores the message, audits and asks for a re-title", async () => {
    const { request, requester } = await makeRequest(db, { body: "first part" });
    const input = { requestId: request.id, chatId: request.chatId!, messageId: 9001, fromId: requester.id, text: "second part" };
    const res = await requests.append(db, actorFor(requester, { via: "telegram" }), input);
    expect(res.request.body).toBe("first part\n\nsecond part");
    expect(res.effects).toEqual([{ kind: "title", requestId: request.id }]);
    const again = await requests.append(db, actorFor(requester, { via: "telegram" }), input);
    expect(again.duplicate).toBe(true);
    expect(again.request.body).toBe("first part\n\nsecond part");
    const timeline = (await requests.getDetail(db, actorFor(requester), request.id)).timeline;
    expect(timeline.map((t) => t.action)).toEqual(["request.create", "request.append"]);
  });

  it("findAppendTarget picks the author's latest open request in this chat, else anywhere", async () => {
    const author = await makePerson(db);
    const chatId = fakeChatId();
    const elsewhere = await makeRequest(db, { requester: author });
    expect((await requests.findAppendTarget(db, { authorPersonId: author.id, chatId }))?.id).toBe(elsewhere.request.id);
    const here = await makeRequest(db, { requester: author, chatId });
    await makeRequest(db, { requester: author }); // newer, but another chat
    expect((await requests.findAppendTarget(db, { authorPersonId: author.id, chatId }))?.id).toBe(here.request.id);
    await requests.setStatus(db, actorFor(author), here.request.id, { status: "done" });
    const fallback = await requests.findAppendTarget(db, { authorPersonId: author.id, chatId });
    expect(fallback?.id).not.toBe(here.request.id);
  });

  it("thread messages are stored, audited, do not touch the body, and dedupe", async () => {
    const { request } = await makeRequest(db, { body: "body" });
    const replier = await makePerson(db);
    const input = { requestId: request.id, chatId: request.chatId!, messageId: 4242, fromId: replier.id, text: "on it" };
    const res = await requests.addThreadMessage(db, actorFor(replier, { via: "telegram" }), input);
    expect(res.duplicate).toBe(false);
    expect((await requests.addThreadMessage(db, actorFor(replier, { via: "telegram" }), input)).duplicate).toBe(true);
    const detail = await requests.getDetail(db, systemActor(), request.id);
    expect(detail.request.body).toBe("body");
    expect(detail.messages.map((m) => m.kind)).toEqual(["original", "thread"]);
    expect(detail.messages[1].from?.id).toBe(replier.id);
    expect(detail.timeline.map((t) => t.action)).toEqual(["request.create", "request.thread"]);
  });

  it("findRequestByTelegramMessage resolves source, command, appended, thread and bot messages", async () => {
    const chatId = fakeChatId();
    const requester = await makePerson(db);
    const assignee = await makePerson(db);
    const { request } = await requests.create(db, actorFor(assignee, { via: "telegram" }), {
      requesterId: requester.id,
      assigneeId: assignee.id,
      body: "source text",
      chatId,
      sourceMessageId: 10,
      messages: [
        { messageId: 10, fromId: requester.id, text: "source text" },
        { messageId: 11, fromId: assignee.id, text: "/request" },
      ],
    });
    const actor = actorFor(requester, { via: "telegram" });
    await requests.append(db, actor, { requestId: request.id, chatId, messageId: 12, fromId: requester.id, text: "more" });
    await requests.addThreadMessage(db, actor, { requestId: request.id, chatId, messageId: 13, fromId: requester.id, text: "thx" });
    await requests.setBotConfirmation(db, systemActor(), request.id, { chatId, messageId: 14 });
    await botMessages.log(db, { chatId, kind: "status", ok: true, telegramMessageId: 15, text: "x", requestId: request.id });
    for (const m of [10, 11, 12, 13, 14, 15])
      expect(await requests.findRequestByTelegramMessage(db, chatId, m), `message ${m}`).toBe(request.id);
    expect(await requests.findRequestByTelegramMessage(db, chatId, 16)).toBeNull();
    expect(await requests.findRequestByTelegramMessage(db, fakeChatId(), 10)).toBeNull();
  });
});

describe("status, comments and fields", () => {
  it("setStatus with a custom label keeps the status, sets done_at, notifies the other side", async () => {
    const requester = await makePerson(db, { startedBot: true });
    const { request, assignee } = await makeRequest(db, { requester });
    const doing = await requests.setStatus(db, actorFor(assignee), request.id, {
      status: "in_progress",
      customStatus: "ordering from Panjim",
    });
    expect(doing.request).toMatchObject({ status: "in_progress", customStatus: "ordering from Panjim", doneAt: null });
    const done = await requests.setStatus(db, actorFor(assignee), request.id, { status: "done", note: "all set" });
    expect(done.request.status).toBe("done");
    expect(done.request.customStatus).toBeNull();
    expect(done.request.doneAt).toBeInstanceOf(Date);
    const notes = done.effects.flatMap((e) => (e.kind === "notify" ? [e.message] : []));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ chatId: requester.telegramId, kind: "status", requestId: request.id });
    expect(notes[0].html).toContain("done");
    const reopened = await requests.setStatus(db, actorFor(requester), request.id, { status: "open" });
    expect(reopened.request.doneAt).toBeNull();
  });

  it("strangers cannot view or change status; admins can", async () => {
    const { request } = await makeRequest(db);
    const stranger = await makePerson(db);
    await expect(requests.setStatus(db, actorFor(stranger), request.id, { status: "done" })).rejects.toBeInstanceOf(
      PermissionError,
    );
    await expect(requests.getDetail(db, actorFor(stranger), request.id)).rejects.toBeInstanceOf(PermissionError);
    const ok = await requests.setStatus(db, actorFor(stranger, { isAdmin: true }), request.id, { status: "declined" });
    expect(ok.request.status).toBe("declined");
    await expect(requests.setStatus(db, systemActor(), 99_999_999, { status: "done" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("comment is an audit row; notify goes to the other side, falling back to the group thread", async () => {
    const { request, requester, assignee } = await makeRequest(db);
    const res = await requests.comment(db, actorFor(assignee), request.id, { text: "will do tomorrow", notify: true });
    const msgs = res.effects.flatMap((e) => (e.kind === "notify" ? [e.message] : []));
    // requester never started the bot: reply in the group under the source message
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ chatId: request.chatId, kind: "group_fallback", replyTo: request.sourceMessageId });
    const silent = await requests.comment(db, actorFor(requester), request.id, { text: "thanks", notify: false });
    expect(silent.effects).toEqual([]);
    const timeline = (await requests.getDetail(db, actorFor(requester), request.id)).timeline;
    expect(timeline.filter((t) => t.action === "request.comment").map((t) => t.summary)).toEqual(["will do tomorrow", "thanks"]);
  });

  it("human edits lock title/priority/due; the AI then leaves them alone", async () => {
    const { request, assignee } = await makeRequest(db);
    const ai = aiActor();
    const t1 = await requests.setTitle(db, ai, request.id, "AI title");
    expect(t1).toMatchObject({ changed: true, request: { title: "AI title", titleLocked: false } });
    const t2 = await requests.setTitle(db, actorFor(assignee), request.id, "Human title");
    expect(t2.request).toMatchObject({ title: "Human title", titleLocked: true });
    const t3 = await requests.setTitle(db, ai, request.id, "AI again");
    expect(t3).toMatchObject({ changed: false, request: { title: "Human title" } });

    await requests.setPriority(db, actorFor(assignee), request.id, "urgent");
    expect((await requests.setPriority(db, ai, request.id, "low")).changed).toBe(false);
    const due = new Date("2026-10-20T12:00:00Z");
    expect((await requests.setDue(db, ai, request.id, due)).request.dueAt?.toISOString()).toBe(due.toISOString());
    await requests.setDue(db, actorFor(assignee), request.id, null);
    expect((await requests.setDue(db, ai, request.id, due)).changed).toBe(false);
    await expect(requests.setPriority(db, actorFor(assignee), request.id, "meh" as never)).rejects.toBeInstanceOf(ValidationError);

    const actions = (await requests.getDetail(db, systemActor(), request.id)).timeline.map((t) => t.action);
    expect(actions).toEqual(["request.create", "request.title", "request.title", "request.priority", "request.due", "request.due"]);
  });

  it("setAiState records ai status and question", async () => {
    const { request } = await makeRequest(db);
    const res = await requests.setAiState(db, aiActor(), request.id, { aiStatus: "done", aiQuestion: "Which hall?" });
    expect(res.request).toMatchObject({ aiStatus: "done", aiQuestion: "Which hall?" });
  });
});

describe("lists", () => {
  it("inbox, raised, between and all with status filters and counts", async () => {
    const me = await makePerson(db);
    const bob = await makePerson(db);
    const r1 = await makeRequest(db, { requester: bob, assignee: me });
    const r2 = await makeRequest(db, { requester: bob, assignee: me });
    const r3 = await makeRequest(db, { requester: me, assignee: bob });
    await makeRequest(db, { assignee: me }); // someone else asks me
    await requests.setStatus(db, actorFor(me), r2.request.id, { status: "done" });

    const inbox = await requests.listInbox(db, actorFor(me), {});
    expect(inbox.counts).toEqual({ open: 2, done: 1, all: 3 });
    expect(inbox.items.map((i) => i.id)).not.toContain(r2.request.id);
    expect(inbox.items[0]).toMatchObject({ requester: { id: expect.any(Number) }, assignee: { id: me.id }, attachmentCount: 0 });

    const doneOnly = await requests.listInbox(db, actorFor(me), { status: "done" });
    expect(doneOnly.items.map((i) => i.id)).toEqual([r2.request.id]);

    const raised = await requests.listRaised(db, actorFor(me), { status: "all" });
    expect(raised.items.map((i) => i.id)).toEqual([r3.request.id]);

    const between = await requests.listBetween(db, actorFor(me), bob.id, { status: "all" });
    expect(between.items.map((i) => i.id).sort()).toEqual([r1.request.id, r2.request.id, r3.request.id].sort());
    expect(between.counts.all).toBe(3);

    await expect(requests.listAll(db, actorFor(me), {})).rejects.toBeInstanceOf(PermissionError);
    const all = await requests.listAll(db, actorFor(me, { isAdmin: true }), { personId: bob.id, status: "all", limit: 50 });
    expect(all.items.length).toBe(3);
  });
});
