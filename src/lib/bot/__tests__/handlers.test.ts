import { randomInt } from "node:crypto";
import { describe, expect, it } from "vitest";
import { testDb } from "@tests/helpers/db";
import { capturingNotifier } from "@tests/helpers/notifier";
import { actorFor, fakeChatId, makePerson, makeRequest } from "@tests/factories";
import { systemActor } from "@/lib/actor";
import { dueLabel } from "@/lib/format";
import type { Person } from "@/lib/types";
import * as audit from "@/services/audit";
import * as botMessages from "@/services/botMessages";
import * as requests from "@/services/requests";
import { handleIntent } from "../handlers";
import type { Intent, MessageCtx, PersonRef, TgChat, TgMessage, TgUser } from "../types";

const db = testDb();
const NOW = new Date("2026-10-12T06:00:00Z"); // 11:30 IST

function setup(now = NOW) {
  const cap = capturingNotifier();
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const deps = {
    notifier: cap.notifier,
    now: () => now,
    tg: async (method: string, body: Record<string, unknown>) => {
      calls.push({ method, body });
      return { ok: true };
    },
  };
  return { ...cap, calls, deps, run: (i: Intent) => handleIntent(db, i, deps) };
}

const user = (p: Person): TgUser => ({ id: p.telegramId!, username: p.username ?? undefined, first_name: p.firstName ?? "T" });
const group = (): TgChat => ({ id: fakeChatId(), type: "supergroup", title: "Volunteers" });
const nextId = () => randomInt(1000, 2 ** 31);

function ctx(chat: TgChat, from: Person, text = "", extra: Partial<TgMessage> = {}): MessageCtx {
  const u = user(from);
  return { chat, from: u, message: { message_id: nextId(), date: 0, chat, from: u, text, ...extra } };
}

const requestIntent = (c: MessageCtx, over: Partial<Extract<Intent, { kind: "request" }>> = {}): Intent => ({
  kind: "request",
  via: "command",
  requester: { by: "user", user: c.from },
  assignee: { by: "superadmin" },
  body: "fix the projector in the main hall",
  note: null,
  source: null,
  attachments: [],
  ...c,
  ...over,
});

describe("request", () => {
  it("creates, replies with the confirmation, stores its id, DMs the assignee with Done / On it; retry is a no-op", async () => {
    const t = setup();
    const alice = await makePerson(db);
    const bob = await makePerson(db, { startedBot: true });
    const c = ctx(group(), alice, `/request @${bob.username} fix the projector in the main hall`);
    const res = await t.run(requestIntent(c, { assignee: { by: "username", username: bob.username! } }));

    expect(res.outcome).toBe("request.created");
    const r = await requests.getById(db, systemActor(), res.requestId!);
    expect(r).toMatchObject({ requesterId: alice.id, assigneeId: bob.id, body: "fix the projector in the main hall", chatId: c.chat.id });
    expect(t.sent).toHaveLength(1);
    const [confirm] = t.sent;
    expect(confirm).toMatchObject({ chatId: c.chat.id, kind: "created", replyTo: c.message.message_id, requestId: r.id });
    expect(confirm.html).toContain(`#${r.id}`);
    expect(confirm.html).toContain(`@${bob.username}`);
    expect(confirm.buttons?.[0]).toMatchObject({ url: expect.stringContaining(`/r/${r.id}`) });
    // the confirmation message (capturing notifier id 1) now resolves to the request
    expect(await requests.findRequestByTelegramMessage(db, c.chat.id, 1)).toBe(r.id);

    expect(res.effects).toContainEqual({ kind: "title", requestId: r.id });
    const dm = res.effects.find((e) => e.kind === "notify");
    expect(dm && dm.kind === "notify" && dm.message).toMatchObject({ chatId: bob.telegramId, kind: "assigned" });
    const datas = dm?.kind === "notify" ? dm.message.buttons?.map((b) => ("callback_data" in b ? b.callback_data : null)) : [];
    expect(datas).toEqual(expect.arrayContaining([`st:${r.id}:done`, `st:${r.id}:in_progress`]));

    const again = await t.run(requestIntent(c, { assignee: { by: "username", username: bob.username! } }));
    expect(again).toMatchObject({ outcome: "request.duplicate", requestId: r.id, effects: [] });
    expect(t.sent).toHaveLength(1);
  });

  it("no DM when the assignee never started the bot; no @ goes to the organiser", async () => {
    const t = setup();
    const alice = await makePerson(db);
    const res = await t.run(requestIntent(ctx(group(), alice, "/request get more chairs")));
    const r = await requests.getById(db, systemActor(), res.requestId!);
    const assignee = await (await import("@/services/people")).getById(db, r.assigneeId);
    expect(assignee?.username).toBe("etm_admin_test");
    expect(res.effects.filter((e) => e.kind === "notify")).toEqual([]);
  });

  it("reply case: requester is the source author, body is the source plus the note, both messages stored", async () => {
    const t = setup();
    const [alice, bob] = [await makePerson(db), await makePerson(db)];
    const chat = group();
    const source: TgMessage = { message_id: nextId(), date: 0, chat, from: user(alice), text: "we need ice for the party" };
    const c = ctx(chat, bob, "/request by 6pm", { reply_to_message: source });
    const res = await t.run(
      requestIntent(c, { requester: { by: "user", user: user(alice) }, assignee: { by: "user", user: c.from }, body: source.text!, note: "by 6pm", source }),
    );
    const d = await requests.getDetail(db, systemActor(), res.requestId!);
    expect(d.request).toMatchObject({ requesterId: alice.id, assigneeId: bob.id, createdById: bob.id, sourceMessageId: source.message_id });
    expect(d.request.body).toBe("we need ice for the party\n\nby 6pm");
    expect(d.messages.map((m) => [m.messageId, m.from?.id])).toEqual([
      [source.message_id, alice.id],
      [c.message.message_id, bob.id],
    ]);
  });

  it("empty request text gets a usage reply and creates nothing", async () => {
    const t = setup();
    const res = await t.run(requestIntent(ctx(group(), await makePerson(db), "/request"), { body: "" }));
    expect(res.outcome).toBe("request.empty");
    expect(res.requestId).toBeUndefined();
    expect(t.sent[0].html).toContain("/request");
  });
});

describe("append", () => {
  it("reply /append to a human message attaches it to the author's latest open request here", async () => {
    const t = setup();
    const { request, requester } = await makeRequest(db);
    const chat: TgChat = { id: request.chatId!, type: "supergroup" };
    const payload: TgMessage = { message_id: nextId(), date: 0, chat, from: user(requester), text: "also the HDMI cable" };
    const someone = await makePerson(db);
    const c = ctx(chat, someone, "/append", { reply_to_message: payload });
    const res = await t.run({ kind: "append", requestId: null, replyTo: payload, payload, text: payload.text!, attachments: [], ...c });
    expect(res).toMatchObject({ outcome: "append.added", requestId: request.id });
    expect(res.effects).toEqual([{ kind: "title", requestId: request.id }]);
    expect((await requests.getById(db, systemActor(), request.id)).body).toContain("also the HDMI cable");
    expect(t.sent[0]).toMatchObject({ chatId: chat.id, replyTo: c.message.message_id });
    expect(t.sent[0].html).toContain(`#${request.id}`);
  });

  it("no target: says so, changes nothing", async () => {
    const t = setup();
    const stranger = await makePerson(db);
    const chat = group();
    const payload: TgMessage = { message_id: nextId(), date: 0, chat, from: user(stranger), text: "hm" };
    const res = await t.run({ kind: "append", requestId: null, replyTo: payload, payload, text: "hm", attachments: [], ...ctx(chat, stranger, "/append") });
    expect(res.outcome).toBe("append.no-target");
    expect(t.sent).toHaveLength(1);
  });
});

describe("reply threads", () => {
  it("SPEC: bot confirms #12 -> Asha -> Ben -> Asha -> Chitra all land on the request, in order, with reply_to", async () => {
    const t = setup();
    const alice = await makePerson(db);
    const chat = group();
    const created = await t.run(requestIntent(ctx(chat, alice, "/request fix the projector")));
    const id = created.requestId!;
    const confirmId = 1; // first message from the capturing notifier
    const [asha, ben, chitra] = [await makePerson(db), await makePerson(db), await makePerson(db)];
    // Asha replies to the bot's confirmation (a pending-reply: appends, per SPEC)
    const a1 = ctx(chat, asha, "I can bring one");
    const r1 = await t.run({ kind: "pending-reply", botMessageId: confirmId, text: "I can bring one", attachments: [], ...a1 });
    expect(r1).toMatchObject({ outcome: "append.added", requestId: id });
    // the rest reply to humans: transitive thread capture
    const ids = [a1.message.message_id];
    // Ben -> Asha's message, Asha -> Ben's, Chitra -> Ben's
    const hops: [Person, () => number][] = [
      [ben, () => ids[0]],
      [asha, () => ids[1]],
      [chitra, () => ids[1]],
    ];
    for (const [who, replyTo] of hops) {
      const c = ctx(chat, who, "reply");
      const res = await t.run({ kind: "thread", replyToMessageId: replyTo(), text: "reply", attachments: [], ...c });
      expect(res).toMatchObject({ outcome: "thread.added", requestId: id, effects: [] });
      ids.push(c.message.message_id);
    }
    const d = await requests.getDetail(db, systemActor(), id);
    const conv = d.messages.filter((m) => m.kind !== "original");
    expect(conv.map((m) => [m.messageId, m.replyToMessageId, m.from?.id, m.kind])).toEqual([
      [ids[0], confirmId, asha.id, "append"],
      [ids[1], ids[0], ben.id, "thread"],
      [ids[2], ids[1], asha.id, "thread"],
      [ids[3], ids[1], chitra.id, "thread"],
    ]);
    expect(t.sent).toHaveLength(2); // confirmation + "Added to"; thread replies never ping
  });

  it("a reply to a message tied to nothing is ignored and never stored", async () => {
    const t = setup();
    const c = ctx(group(), await makePerson(db), "lol");
    expect(await t.run({ kind: "thread", replyToMessageId: 42, text: "lol", attachments: [], ...c })).toMatchObject({ outcome: "thread.unrelated" });
    expect(await requests.findRequestByTelegramMessage(db, c.chat.id, c.message.message_id)).toBeNull();
  });
});

describe("mention prompt", () => {
  it("'@bot @bob' asks what bob should do; the reply becomes the request; a second reply is only thread", async () => {
    const t = setup();
    const [alice, bob] = [await makePerson(db), await makePerson(db)];
    const chat = group();
    const p = await t.run({ kind: "prompt", assignee: { by: "username", username: bob.username! }, ...ctx(chat, alice, `@bot @${bob.username}`) });
    expect(p.outcome).toBe("prompt.created");
    expect(t.sent[0]).toMatchObject({ kind: "prompt" });
    expect(t.sent[0].html).toContain(`@${bob.username}`);

    const reply = ctx(chat, alice, "carry the speakers to the beach");
    const res = await t.run({ kind: "pending-reply", botMessageId: 1, text: "carry the speakers to the beach", attachments: [], ...reply });
    expect(res.outcome).toBe("request.created");
    const r = await requests.getById(db, systemActor(), res.requestId!);
    expect(r).toMatchObject({ requesterId: alice.id, assigneeId: bob.id, body: "carry the speakers to the beach" });

    const again = await t.run({ kind: "pending-reply", botMessageId: 1, text: "and the mics", attachments: [], ...ctx(chat, alice, "and the mics") });
    expect(again).toMatchObject({ outcome: "thread.added", requestId: r.id });
  });

  it("an expired prompt is not a request", async () => {
    const t = setup();
    const [alice, bob] = [await makePerson(db), await makePerson(db)];
    const chat = group();
    await t.run({ kind: "prompt", assignee: { by: "username", username: bob.username! }, ...ctx(chat, alice, "@bot @bob") });
    const late = setup(new Date(NOW.getTime() + 2 * 3600_000));
    const res = await handleIntent(db, { kind: "pending-reply", botMessageId: 1, text: "x", attachments: [], ...ctx(chat, alice, "x") }, late.deps);
    expect(res.outcome).toBe("prompt.expired");
  });
});

const status = (
  c: MessageCtx,
  st: Extract<Intent, { kind: "status" }>["status"],
  over: { requestId?: number | null; replyToMessageId?: number | null; note?: string | null } = {},
): Intent => ({ kind: "status", status: st, requestId: over.requestId ?? null, replyToMessageId: over.replyToMessageId ?? null, note: over.note ?? null, ...c });

describe("list commands", () => {
  const list = (c: MessageCtx, command: Extract<Intent, { kind: "list" }>["command"], over: { who?: PersonRef; requestId?: number | null } = {}): Intent => ({
    kind: "list",
    command,
    who: over.who ?? null,
    requestId: over.requestId ?? null,
    ...c,
  });

  it("/mine: max 10, '#id title — status · due' with IST due labels, a dashboard button", async () => {
    const t = setup();
    const me = await makePerson(db);
    const ids: number[] = [];
    for (let i = 0; i < 12; i++) ids.push((await makeRequest(db, { assignee: me, title: `Task ${i}` })).request.id);
    const due = new Date(NOW.getTime() + 24 * 3600_000);
    await requests.setDue(db, systemActor(), ids[11], due);
    await requests.setStatus(db, systemActor(), ids[11], { status: "in_progress", customStatus: "ordering from Panjim" });
    await t.run(list(ctx(group(), me, "/mine"), "mine"));
    const html = t.sent[0].html;
    const lines = html.split("\n").filter((l) => /^#\d+ /.test(l));
    expect(lines).toHaveLength(10);
    expect(lines[0]).toBe(`#${ids[11]} Task 11 — ordering from Panjim · ${dueLabel(due, NOW)!.text}`);
    expect(dueLabel(due, NOW)!.text).toBe("due tomorrow");
    expect(lines[1]).toBe(`#${ids[10]} Task 10 — Open`);
    expect(html).toContain("2 more");
    expect(t.sent[0].buttons?.[0]).toMatchObject({ url: expect.stringContaining("/inbox") });
  });

  it("/raised and /with @bob, and an empty list", async () => {
    const t = setup();
    const [me, bob] = [await makePerson(db), await makePerson(db)];
    const a = await makeRequest(db, { requester: me, assignee: bob, title: "Mine to bob" });
    const b = await makeRequest(db, { requester: bob, assignee: me, title: "Bob to me" });
    const chat = group();
    await t.run(list(ctx(chat, me, "/raised"), "raised"));
    expect(t.sent[0].html).toContain(`#${a.request.id} Mine to bob`);
    expect(t.sent[0].html).not.toContain("Bob to me");
    await t.run(list(ctx(chat, me, "/with"), "with", { who: { by: "username", username: bob.username! } }));
    expect(t.sent[1].html).toContain(`#${a.request.id}`);
    expect(t.sent[1].html).toContain(`#${b.request.id}`);
    await t.run(list(ctx(chat, await makePerson(db), "/mine"), "mine"));
    expect(t.sent[2].html).not.toMatch(/#\d+/);
  });

  it("/status 12 for participants only", async () => {
    const t = setup();
    const { request, requester } = await makeRequest(db, { title: "Fix projector" });
    await t.run(list(ctx(group(), requester, "/status"), "status", { requestId: request.id }));
    expect(t.sent[0].html).toContain(`#${request.id} Fix projector — Open`);
    const res = await t.run(list(ctx(group(), await makePerson(db), "/status"), "status", { requestId: request.id }));
    expect(res.outcome).toBe("list.error");
    expect(t.sent[1].html).toMatch(/only the people/i);
    await t.run(list(ctx(group(), requester, "/status"), "status"));
    expect(t.sent[2].html).toContain("/status 12");
  });

  it("/done 12: strangers can't, the assignee can (and the requester is told)", async () => {
    const t = setup();
    const requester = await makePerson(db, { startedBot: true });
    const { request, assignee } = await makeRequest(db, { requester });
    const chat = group();
    const no = await t.run(status(ctx(chat, await makePerson(db), "/done"), "done", { requestId: request.id }));
    expect(no.outcome).toBe("status.error"); // an explicit id from outside: the generic error, no names
    expect((await requests.getById(db, systemActor(), request.id)).status).toBe("open");

    const yes = await t.run(status(ctx(chat, assignee, "/done"), "done", { requestId: request.id }));
    expect(yes).toMatchObject({ outcome: "status.set", requestId: request.id });
    expect((await requests.getById(db, systemActor(), request.id)).status).toBe("done");
    expect(yes.effects).toContainEqual(expect.objectContaining({ kind: "notify", message: expect.objectContaining({ chatId: requester.telegramId }) }));
    expect(t.sent[1].html).toContain(`#${request.id}`);
  });

  it("/help", async () => {
    const t = setup();
    await t.run(list(ctx(group(), await makePerson(db), "/help"), "help"));
    expect(t.sent[0].html).toContain("/mine");
    expect(t.sent[0].html).toContain("/request");
  });
});

describe("buttons and the rest", () => {
  it("'Done' on the assignee DM marks it done and answers the tap", async () => {
    const t = setup();
    const { request, assignee } = await makeRequest(db);
    const res = await t.run({ kind: "status-button", requestId: request.id, status: "done", callbackQueryId: "cb1", from: user(assignee), message: null });
    expect(res.outcome).toBe("status.set");
    expect((await requests.getById(db, systemActor(), request.id)).status).toBe("done");
    expect(t.calls[0]).toMatchObject({ method: "answerCallbackQuery", body: { callback_query_id: "cb1" } });
  });

  it("bare @bot mention gets the short help", async () => {
    const t = setup();
    expect((await t.run({ kind: "help-mention", ...ctx(group(), await makePerson(db), "@bot") })).outcome).toBe("help");
    expect(t.sent[0].html).toContain("/help");
  });

  it("/start without a code: welcome with a login link, and they can now be DMed", async () => {
    const t = setup();
    const p = await makePerson(db, { startedBot: false });
    const c = ctx({ id: p.telegramId!, type: "private" }, p, "/start");
    expect((await t.run({ kind: "start", code: null, ...c })).outcome).toBe("start.welcome");
    expect(t.sent[0].buttons?.[0]).toMatchObject({ url: expect.stringContaining("/login?code=") });
    const after = await (await import("@/services/people")).getById(db, p.id);
    expect(after?.startedBot).toBe(true);
  });
});

describe("verify round 1: status from anywhere in the thread", () => {
  async function threaded() {
    const sourceId = nextId();
    const made = await makeRequest(db, { messageId: sourceId, title: "Fix projector" });
    const chat: TgChat = { id: made.request.chatId!, type: "supergroup" };
    return { ...made, chat, sourceId };
  }

  it("the assignee replies '/done projector fixed' to a thread message: done, note kept, '#N' reply", async () => {
    const t = setup();
    const { request, assignee, chat, sourceId } = await threaded();
    const res = await t.run(status(ctx(chat, assignee, "/done projector fixed"), "done", { replyToMessageId: sourceId, note: "projector fixed" }));
    expect(res).toMatchObject({ outcome: "status.set", requestId: request.id });
    const d = await requests.getDetail(db, systemActor(), request.id);
    expect(d.request.status).toBe("done");
    expect(d.timeline.at(-1)).toMatchObject({ action: "request.status", data: expect.objectContaining({ note: "projector fixed" }) });
    // the requester never started the bot: the "@alice, ✅ #N is done" group fallback says it in this chat
    expect(t.sent).toHaveLength(0);
    expect(res.effects).toContainEqual(expect.objectContaining({ message: expect.objectContaining({ chatId: chat.id, kind: "group_fallback" }) }));
  });

  it("/waiting <reason> sets the custom label; /reopen opens it again", async () => {
    const t = setup();
    const { request, requester, chat, sourceId } = await threaded();
    await t.run(status(ctx(chat, requester, "/waiting parts from Panjim"), "waiting", { replyToMessageId: sourceId, note: "parts from Panjim" }));
    expect(await requests.getById(db, systemActor(), request.id)).toMatchObject({ status: "waiting", customStatus: "parts from Panjim" });
    await t.run(status(ctx(chat, requester, "/reopen"), "open", { replyToMessageId: sourceId }));
    expect(await requests.getById(db, systemActor(), request.id)).toMatchObject({ status: "open", customStatus: null });
  });

  it("someone else gets 'Only @assignee or @requester can close #N'; their message still lands in the thread", async () => {
    const t = setup();
    const { request, assignee, chat, sourceId } = await threaded();
    const c = ctx(chat, await makePerson(db), "/done");
    const res = await t.run(status(c, "done", { replyToMessageId: sourceId }));
    expect(res.outcome).toBe("status.forbidden");
    expect(t.sent[0].html).toContain(`@${assignee.username}`);
    expect(t.sent[0].html).toContain(`#${request.id}`);
    expect(await requests.findRequestByTelegramMessage(db, chat.id, c.message.message_id)).toBe(request.id);
    expect((await requests.getById(db, systemActor(), request.id)).status).toBe("open");
  });

  it("no request in the chain: 'Reply to a request message, or use /done 12'", async () => {
    const t = setup();
    const res = await t.run(status(ctx(group(), await makePerson(db), "/done"), "done", { replyToMessageId: 42 }));
    expect(res.outcome).toBe("status.no-target");
    expect(t.sent[0].html).toMatch(/Reply to a request message/);
  });

  it("the assignee's bare 'done' reply is a thread message plus a one-tap 'Mark #N done?' button", async () => {
    const t = setup();
    const { request, assignee, requester, chat, sourceId } = await threaded();
    const res = await t.run({ kind: "thread", replyToMessageId: sourceId, text: "done ✅", attachments: [], ...ctx(chat, assignee, "done ✅") });
    expect(res.outcome).toBe("thread.added");
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].html).toContain(`Mark #${request.id} done?`);
    expect(t.sent[0].buttons?.[0]).toMatchObject({ callback_data: `st:${request.id}:done` });
    // anyone else saying "done" is just conversation
    await t.run({ kind: "thread", replyToMessageId: sourceId, text: "done", attachments: [], ...ctx(chat, requester, "done") });
    expect(t.sent).toHaveLength(1);
  });
});

describe("verify round 1: replies to bot messages, /append and prompts", () => {
  it("a reply to a bot message other than the '#N created' confirmation is a thread message, not an append", async () => {
    const t = setup();
    const { request } = await makeRequest(db, { body: "body" });
    const chat: TgChat = { id: request.chatId!, type: "supergroup" };
    await botMessages.log(db, { chatId: chat.id, kind: "group_fallback", ok: true, telegramMessageId: 555, text: "done", requestId: request.id });
    const res = await t.run({ kind: "pending-reply", botMessageId: 555, text: "thanks!!", attachments: [], ...ctx(chat, await makePerson(db), "thanks!!") });
    expect(res).toMatchObject({ outcome: "thread.added", requestId: request.id, effects: [] });
    expect(t.sent).toHaveLength(0);
    expect((await requests.getById(db, systemActor(), request.id)).body).toBe("body");
  });

  it("/append on a message already in the thread moves it into the body", async () => {
    const t = setup();
    const { request, requester } = await makeRequest(db, { body: "body" });
    const chat: TgChat = { id: request.chatId!, type: "supergroup" };
    const asha = await makePerson(db);
    const threadMsg = ctx(chat, asha, "also need an HDMI adapter");
    await requests.addThreadMessage(db, actorFor(asha, { via: "telegram" }), {
      requestId: request.id, chatId: chat.id, messageId: threadMsg.message.message_id, fromId: asha.id, text: "also need an HDMI adapter",
    });
    const payload = threadMsg.message;
    const res = await t.run({ kind: "append", requestId: null, replyTo: payload, payload, text: payload.text!, attachments: [], ...ctx(chat, requester, "/append", { reply_to_message: payload }) });
    expect(res).toMatchObject({ outcome: "append.added", requestId: request.id });
    expect((await requests.getById(db, systemActor(), request.id)).body).toBe("body\n\nalso need an HDMI adapter");
    expect(t.sent[0].html).toContain(`#${request.id}`);
  });

  it("a second reply to a used prompt lands in that request's thread; a reply to an expired one is told so", async () => {
    const t = setup();
    const [alice, bob] = [await makePerson(db), await makePerson(db)];
    const chat = group();
    await t.run({ kind: "prompt", assignee: { by: "username", username: bob.username! }, ...ctx(chat, alice, `@bot @${bob.username}`) });
    const first = await t.run({ kind: "pending-reply", botMessageId: 1, text: "carry the speakers", attachments: [], ...ctx(chat, alice, "carry the speakers") });
    const second = await t.run({ kind: "pending-reply", botMessageId: 1, text: "which room?", attachments: [], ...ctx(chat, bob, "which room?") });
    expect(second).toMatchObject({ outcome: "thread.added", requestId: first.requestId });

    const t2 = setup();
    const chat2 = group();
    await t2.run({ kind: "prompt", assignee: { by: "username", username: bob.username! }, ...ctx(chat2, alice, `@bot @${bob.username}`) });
    const late = setup(new Date(NOW.getTime() + 2 * 3600_000));
    const res = await handleIntent(db, { kind: "pending-reply", botMessageId: 1, text: "x", attachments: [], ...ctx(chat2, alice, "x") }, late.deps);
    expect(res.outcome).toBe("prompt.expired");
    expect(late.sent[0].html).toMatch(/expired/);
    expect(late.sent[0].html).toContain(`@${bob.username}`);
  });
});

describe("verify round 2: status commands are stored and deduped; prompts belong to their requester", () => {
  async function threaded() {
    const sourceId = nextId();
    const made = await makeRequest(db, { messageId: sourceId, title: "Fix projector" });
    const chat: TgChat = { id: made.request.chatId!, type: "supergroup" };
    return { ...made, chat, sourceId };
  }
  const statusRows = async (id: number) => (await audit.listForEntity(db, "request", id)).filter((r) => r.action === "request.status");

  it("'/waiting need quote' in the thread is stored, so a reply to it still chains to the request", async () => {
    const t = setup();
    const { request, assignee, requester, chat, sourceId } = await threaded();
    const c = ctx(chat, assignee, "/waiting need quote from Panjim vendor");
    expect((await t.run(status(c, "waiting", { replyToMessageId: sourceId, note: "need quote from Panjim vendor" }))).outcome).toBe("status.set");
    expect(await requests.findRequestByTelegramMessage(db, chat.id, c.message.message_id)).toBe(request.id);
    const res = await t.run({ kind: "thread", replyToMessageId: c.message.message_id, text: "here's the quote", attachments: [], ...ctx(chat, requester, "here's the quote") });
    expect(res).toMatchObject({ outcome: "thread.added", requestId: request.id });
  });

  it("a redelivered '/done' in the thread changes nothing the second time", async () => {
    const t = setup();
    const { request, assignee, chat, sourceId } = await threaded();
    const intent = status(ctx(chat, assignee, "/done projector fixed"), "done", { replyToMessageId: sourceId, note: "projector fixed" });
    await t.run(intent);
    const sent = t.sent.length;
    const again = await t.run(intent);
    expect(again).toMatchObject({ outcome: "status.duplicate", requestId: request.id, effects: [] });
    expect(t.sent).toHaveLength(sent);
    expect(await statusRows(request.id)).toHaveLength(1);
  });

  it("'/done 12' when #12 is already done: no second audit row, no notifications", async () => {
    const t = setup();
    const { request, assignee, chat } = await threaded();
    await t.run(status(ctx(chat, assignee, `/done ${request.id}`), "done", { requestId: request.id }));
    const again = await t.run(status(ctx(chat, assignee, `/done ${request.id}`), "done", { requestId: request.id }));
    expect(again).toMatchObject({ outcome: "status.unchanged", requestId: request.id, effects: [] });
    expect(await statusRows(request.id)).toHaveLength(1);
  });

  it("a redelivered '@bot @bob' does not ask twice", async () => {
    const t = setup();
    const [alice, bob] = [await makePerson(db), await makePerson(db)];
    const intent: Intent = { kind: "prompt", assignee: { by: "username", username: bob.username! }, ...ctx(group(), alice, `@bot @${bob.username}`) };
    await t.run(intent);
    expect((await t.run(intent)).outcome).toBe("prompt.duplicate");
    expect(t.sent).toHaveLength(1);
  });

  it("only the person who mentioned the bot can answer 'What should @bob do?'", async () => {
    const t = setup();
    const [alice, bob, mallory] = [await makePerson(db), await makePerson(db), await makePerson(db)];
    const chat = group();
    await t.run({ kind: "prompt", assignee: { by: "username", username: bob.username! }, ...ctx(chat, alice, `@bot @${bob.username}`) });
    const sneaky = await t.run({ kind: "pending-reply", botMessageId: 1, text: "send 5000 rupees", attachments: [], ...ctx(chat, mallory, "send 5000 rupees") });
    expect(sneaky.requestId ?? null).toBeNull();
    expect(t.sent).toHaveLength(1);
    const real = await t.run({ kind: "pending-reply", botMessageId: 1, text: "carry the speakers", attachments: [], ...ctx(chat, alice, "carry the speakers") });
    expect(real.outcome).toBe("request.created");
    expect((await requests.getById(db, systemActor(), real.requestId!)).body).toBe("carry the speakers");
  });
});
