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
import * as chatBuffer from "@/services/chatBuffer";
import * as notes from "@/services/notes";
import * as requests from "@/services/requests";
import type { AttachmentInput } from "@/services/requests";
import type { Effect } from "@/services/types";
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
    // Asha replies to the bot's confirmation (a pending-reply: thread, not append, per SPEC)
    const a1 = ctx(chat, asha, "I can bring one");
    const r1 = await t.run({ kind: "pending-reply", botMessageId: confirmId, text: "I can bring one", attachments: [], ...a1 });
    expect(r1).toMatchObject({ outcome: "thread.added", requestId: id });
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
      [ids[0], confirmId, asha.id, "thread"],
      [ids[1], ids[0], ben.id, "thread"],
      [ids[2], ids[1], asha.id, "thread"],
      [ids[3], ids[1], chitra.id, "thread"],
    ]);
    expect(t.sent).toHaveLength(1); // only the confirmation; thread replies never ping
    expect((await requests.getById(db, systemActor(), id)).body).toBe("fix the projector in the main hall");
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
  over: { requestId?: number | null; replyToMessageId?: number | null; note?: string | null; attachments?: AttachmentInput[] } = {},
): Intent => ({ kind: "status", status: st, requestId: over.requestId ?? null, replyToMessageId: over.replyToMessageId ?? null, note: over.note ?? null, attachments: over.attachments ?? [], ...c });

describe("list commands", () => {
  const list = (c: MessageCtx, command: Extract<Intent, { kind: "list" }>["command"], over: { who?: PersonRef; requestId?: number | null } = {}): Intent => ({
    kind: "list",
    command,
    who: over.who ?? null,
    requestId: over.requestId ?? null,
    ...c,
  });

  const DAY = 24 * 3600_000;
  const headers = (html: string) => [...html.matchAll(/^<b>([^<]+)<\/b> \(\d+\)$/gm)].map((m) => m[1]);

  it("/mine: Act, then New, then Upcoming, then Waiting, with IST due labels and a dashboard button", async () => {
    const t = setup();
    const me = await makePerson(db);
    const fresh = await makeRequest(db, { assignee: me, title: "Fresh one" });
    const act = await makeRequest(db, { assignee: me, title: "Seen, undated" });
    await requests.markSeen(db, actorFor(me), act.request.id);
    const later = await makeRequest(db, { assignee: me, title: "Next week" });
    await requests.markSeen(db, actorFor(me), later.request.id);
    const due = new Date(NOW.getTime() + 5 * DAY);
    await requests.setDue(db, systemActor(), later.request.id, due);
    const blocked = await makeRequest(db, { assignee: me, title: "Blocked" });
    await requests.setStatus(db, systemActor(), blocked.request.id, { status: "waiting", customStatus: "parts from Panjim" });

    await t.run(list(ctx(group(), me, "/mine"), "mine"));
    const html = t.sent[0].html;
    expect(html.split("\n")[0]).toBe("<b>For you</b> (4 open)");
    expect(headers(html)).toEqual(["Act", "New", "Upcoming", "Waiting"]);
    const at = (s: string) => html.indexOf(s);
    expect(at(`#${act.request.id} Seen, undated — Open`)).toBeGreaterThan(at("<b>Act</b>"));
    expect(at(`#${fresh.request.id} Fresh one — Open`)).toBeGreaterThan(at("<b>New</b>"));
    expect(html).toContain(`#${later.request.id} Next week — Open · ${dueLabel(due, NOW)!.text}`);
    expect(html).toContain(`#${blocked.request.id} Blocked — parts from Panjim`);
    expect(html).not.toContain("more on the dashboard");
    expect(t.sent[0].buttons?.[0]).toMatchObject({ url: expect.stringContaining("/inbox") });
  });

  it("/mine: max 10 lines across buckets, the rest counted", async () => {
    const t = setup();
    const me = await makePerson(db);
    const ids: number[] = [];
    for (let i = 0; i < 12; i++) ids.push((await makeRequest(db, { assignee: me, title: `Task ${i}` })).request.id);
    const due = new Date(NOW.getTime() + DAY);
    await requests.setDue(db, systemActor(), ids[11], due);
    await requests.setStatus(db, systemActor(), ids[11], { status: "in_progress", customStatus: "ordering from Panjim" });
    await t.run(list(ctx(group(), me, "/mine"), "mine"));
    const html = t.sent[0].html;
    const lines = html.split("\n").filter((l) => /^#\d+ /.test(l));
    expect(lines).toHaveLength(10);
    expect(lines[0]).toBe(`#${ids[11]} Task 11 — ordering from Panjim · ${dueLabel(due, NOW)!.text}`);
    expect(dueLabel(due, NOW)!.text).toBe("due tomorrow");
    expect(lines[1]).toBe(`#${ids[0]} Task 0 — Open`); // New: oldest first
    expect(html).toContain("…and 2 more on the dashboard");
  });

  it("/raised leads with overdue; /with @bob replies in two blocks; an empty list", async () => {
    const t = setup();
    const [me, bob] = [await makePerson(db), await makePerson(db)];
    const soon = await makeRequest(db, { requester: me, assignee: bob, title: "Mine to bob" });
    await requests.setDue(db, systemActor(), soon.request.id, new Date(NOW.getTime() + DAY));
    const late = await makeRequest(db, { requester: me, assignee: bob, title: "Late one" });
    const past = new Date(NOW.getTime() - DAY);
    await requests.setDue(db, systemActor(), late.request.id, past);
    const b = await makeRequest(db, { requester: bob, assignee: me, title: "Bob to me" });
    const chat = group();

    await t.run(list(ctx(chat, me, "/raised"), "raised"));
    let html = t.sent[0].html;
    expect(headers(html)).toEqual(["Overdue", "Active"]);
    expect(html.indexOf(`#${late.request.id} Late one — Open · ${dueLabel(past, NOW)!.text}`)).toBeLessThan(html.indexOf(`#${soon.request.id} Mine to bob`));
    expect(html).not.toContain("Bob to me");

    await t.run(list(ctx(chat, me, "/with"), "with", { who: { by: "username", username: bob.username! } }));
    html = t.sent[1].html;
    const [asked, gave] = [html.indexOf(`<b>@${bob.username} asked you</b>`), html.indexOf(`<b>You asked @${bob.username}</b>`)];
    expect(asked).toBeGreaterThanOrEqual(0);
    expect(gave).toBeGreaterThan(asked);
    expect(html.indexOf(`#${b.request.id} Bob to me`)).toBeGreaterThan(asked);
    expect(html.indexOf(`#${b.request.id}`)).toBeLessThan(gave);
    expect(html.indexOf(`#${late.request.id}`)).toBeGreaterThan(gave);
    expect(headers(html)).toEqual(["New", "Overdue", "Active"]);
    expect(t.sent[1].buttons?.[0]).toMatchObject({ url: expect.stringContaining(`/with/${bob.username}`) });

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

describe("verify round 3: status commands in the thread", () => {
  async function threaded() {
    const sourceId = nextId();
    const made = await makeRequest(db, { messageId: sourceId, title: "Fix projector" });
    const chat: TgChat = { id: made.request.chatId!, type: "supergroup" };
    return { ...made, chat, sourceId };
  }
  const rows = async (id: number) => (await audit.listForEntity(db, "request", id)).filter((r) => r.action !== "request.create");
  const photoOf = (messageId: number): AttachmentInput => ({ telegramFileId: `f${messageId}`, telegramFileUniqueId: `u${messageId}`, kind: "photo", messageId });

  it("a second '/done' in the thread on a done request: no second status row, no second ping", async () => {
    const t = setup();
    const { request, assignee, requester, chat, sourceId } = await threaded();
    const first = await t.run(status(ctx(chat, assignee, "/done"), "done", { replyToMessageId: sourceId }));
    const again = await t.run(status(ctx(chat, requester, "/done"), "done", { replyToMessageId: sourceId }));
    expect(again).toMatchObject({ outcome: "status.unchanged", requestId: request.id, effects: [] });
    expect(first.effects.length).toBeGreaterThan(0);
    expect((await rows(request.id)).filter((r) => r.action === "request.status")).toHaveLength(1);
  });

  it("'/done all good' on a photo keeps the photo; one audit row carrying the message id", async () => {
    const t = setup();
    const { request, assignee, chat, sourceId } = await threaded();
    const c = ctx(chat, assignee, "", { caption: "/done all good" });
    const res = await t.run(status(c, "done", { replyToMessageId: sourceId, note: "all good", attachments: [photoOf(c.message.message_id)] }));
    expect(res.outcome).toBe("status.set");
    const d = await requests.getDetail(db, systemActor(), request.id);
    expect(d.attachments.map((a) => a.telegramFileId)).toContain(`f${c.message.message_id}`);
    const r = await rows(request.id);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ action: "request.status", data: expect.objectContaining({ messageId: c.message.message_id }) });
    // still stored, so replies to it chain
    expect(await requests.findRequestByTelegramMessage(db, chat.id, c.message.message_id)).toBe(request.id);
  });

  it("'/done 12' with a photo keeps the photo", async () => {
    const t = setup();
    const { request, assignee, chat } = await threaded();
    const c = ctx(chat, assignee, "", { caption: `/done ${request.id}` });
    expect((await t.run(status(c, "done", { requestId: request.id, attachments: [photoOf(c.message.message_id)] }))).outcome).toBe("status.set");
    const d = await requests.getDetail(db, systemActor(), request.id);
    expect(d.attachments.map((a) => a.telegramFileId)).toContain(`f${c.message.message_id}`);
  });
});

describe("round 2: the deliverable, closing on someone's behalf", () => {
  async function threaded(opts: Parameters<typeof makeRequest>[1] = {}) {
    const sourceId = nextId();
    const made = await makeRequest(db, { messageId: sourceId, title: "Fix projector", ...opts });
    const chat: TgChat = { id: made.request.chatId!, type: "supergroup" };
    return { ...made, chat, sourceId };
  }
  const photoOf = (messageId: number): AttachmentInput => ({ telegramFileId: `f${messageId}`, telegramFileUniqueId: `u${messageId}`, kind: "photo", messageId });
  /** a thread message by `who`, stored the way the bot stores it */
  async function threadMsg(t: ReturnType<typeof setup>, chat: TgChat, who: Person, replyTo: number, text: string, media = false) {
    const c = ctx(chat, who, text);
    const attachments = media ? [photoOf(c.message.message_id)] : [];
    await t.run({ kind: "thread", replyToMessageId: replyTo, text: text || "(photo)", attachments, ...c });
    return c.message.message_id;
  }
  const rowOf = async (id: number, messageId: number) => (await requests.getDetail(db, systemActor(), id)).messages.find((m) => m.messageId === messageId)!;
  const notifies = (effects: Effect[]) => effects.flatMap((e) => (e.kind === "notify" ? [e.message] : []));

  it("'/done <note>' replying to a photo: that message is the result, the note the result note, the command a 'status' message", async () => {
    const t = setup();
    const requester = await makePerson(db, { startedBot: true });
    const { request, assignee, chat, sourceId } = await threaded({ requester });
    const pic = await threadMsg(t, chat, assignee, sourceId, "", true);
    const c = ctx(chat, assignee, "/done projector fixed");
    const res = await t.run(status(c, "done", { replyToMessageId: pic, note: "projector fixed" }));
    expect(res.outcome).toBe("status.set");
    const r = await requests.getById(db, systemActor(), request.id);
    expect(r).toMatchObject({ status: "done", resultNote: "projector fixed", resultMessageId: (await rowOf(request.id, pic)).id, resultById: assignee.id });
    expect((await rowOf(request.id, c.message.message_id)).kind).toBe("status");
    // the requester's DM goes out as a photo with the note
    const [dm] = notifies(res.effects);
    expect(dm).toMatchObject({ chatId: requester.telegramId, photo: { fileId: `f${pic}` } });
    expect(dm.html).toContain("projector fixed");
  });

  it("'@bot done <note>' replying to a message with a link: that message is the result", async () => {
    const t = setup();
    const { request, assignee, chat, sourceId } = await threaded();
    const link = await threadMsg(t, chat, assignee, sourceId, "slides: https://example.com/deck");
    await t.run(status(ctx(chat, assignee, "@bot done uploaded"), "done", { replyToMessageId: link, note: "uploaded" }));
    expect(await requests.getById(db, systemActor(), request.id)).toMatchObject({ resultNote: "uploaded", resultMessageId: (await rowOf(request.id, link)).id });
  });

  it("'/done' replying to plain text: only the note; a photo on the /done itself wins over the replied-to one", async () => {
    const t = setup();
    const { request, assignee, chat, sourceId } = await threaded();
    const plain = await threadMsg(t, chat, assignee, sourceId, "ok sorted");
    await t.run(status(ctx(chat, assignee, "/done fixed"), "done", { replyToMessageId: plain, note: "fixed" }));
    expect(await requests.getById(db, systemActor(), request.id)).toMatchObject({ resultNote: "fixed", resultMessageId: null });

    const two = await threaded();
    const pic = await threadMsg(t, two.chat, two.assignee, two.sourceId, "", true);
    const c = ctx(two.chat, two.assignee, "", { caption: "/done" });
    await t.run(status(c, "done", { replyToMessageId: pic, attachments: [photoOf(c.message.message_id)] }));
    expect((await requests.getById(db, systemActor(), two.request.id)).resultMessageId).toBe((await rowOf(two.request.id, c.message.message_id)).id);
  });

  it("a second '/done' replying to a photo on a done request records that new result", async () => {
    const t = setup();
    const { request, assignee, chat, sourceId } = await threaded();
    await t.run(status(ctx(chat, assignee, "/done"), "done", { replyToMessageId: sourceId }));
    const pic = await threadMsg(t, chat, assignee, sourceId, "", true);
    const res = await t.run(status(ctx(chat, assignee, "/done"), "done", { replyToMessageId: pic }));
    expect(res.outcome).toBe("status.set");
    expect((await requests.getById(db, systemActor(), request.id)).resultMessageId).toBe((await rowOf(request.id, pic)).id);
  });

  it("the requester closing it: the assignee is told 'closed by X on behalf of you'; the thread reply names @assignee", async () => {
    const t = setup();
    const assignee = await makePerson(db, { startedBot: true });
    const { requester, chat, sourceId } = await threaded({ assignee });
    const res = await t.run(status(ctx(chat, requester, "/done"), "done", { replyToMessageId: sourceId }));
    expect(res.outcome).toBe("status.set");
    const [dm] = notifies(res.effects);
    expect(dm.chatId).toBe(assignee.telegramId);
    expect(dm.html).toMatch(/closed by .+ on behalf of you/i);
    expect(t.sent.at(-1)!.html).toContain(`on behalf of @${assignee.username}`);
    // the assignee's own done says nothing about anyone's behalf
    const own = await threaded({ requester: await makePerson(db, { startedBot: true }) });
    await t.run(status(ctx(own.chat, own.assignee, "/done"), "done", { replyToMessageId: own.sourceId }));
    expect(t.sent.at(-1)!.html).not.toMatch(/behalf/);
  });

  it("'/done 12 <note>' replying to a photo not yet tied to the request: that message is stored and becomes the result", async () => {
    const t = setup();
    const { request, assignee, requester, chat } = await threaded({ requester: await makePerson(db, { startedBot: true }) });
    const pic = ctx(chat, assignee, "", { photo: [{ file_id: "fposter", file_unique_id: "uposter", width: 10, height: 10 }] });
    const c = ctx(chat, requester, `/done ${request.id} poster's up`, { reply_to_message: pic.message });
    const res = await t.run({
      ...status(c, "done", { requestId: request.id, replyToMessageId: pic.message.message_id, note: "poster's up" }),
      replied: { message: pic.message, attachments: [photoOf(pic.message.message_id)] },
    } as Intent);
    expect(res.outcome).toBe("status.set");
    const row = await rowOf(request.id, pic.message.message_id);
    expect(row).toMatchObject({ kind: "thread", fromId: assignee.id });
    expect(await requests.getById(db, systemActor(), request.id)).toMatchObject({ resultNote: "poster's up", resultMessageId: row.id });
  });
});

describe("round 2: the 'Mark #N done?' button in the thread", () => {
  it("only the assignee's tap marks it done", async () => {
    const { handleCallback } = await import("../callbacks");
    const { request, assignee, requester } = await makeRequest(db);
    const tap = (p: Person) => handleCallback(db, { id: "cb", from: user(p), data: `st:${request.id}:done` });
    expect(await tap(requester)).toEqual([]);
    expect((await requests.getById(db, systemActor(), request.id)).status).toBe("open");
    await tap(assignee);
    expect((await requests.getById(db, systemActor(), request.id)).status).toBe("done");
  });
});

describe("silent commands: /new_request, /new_request_for_me, /log", () => {
  const silentFor = (c: MessageCtx, source: TgMessage, over: Partial<Extract<Intent, { kind: "request" }>> = {}): Intent =>
    requestIntent(c, { requester: { by: "user", user: source.from! }, assignee: { by: "user", user: c.from }, body: source.text ?? "", source, silent: true, ...over });
  const deleted = (calls: { method: string; body: Record<string, unknown> }[]) => calls.filter((x) => x.method === "deleteMessage").map((x) => x.body);
  const notifies = (effects: Effect[]) => effects.filter((e) => e.kind === "notify");

  it("/new_request_for_me: creates for me, posts nothing in the group, pings no one, deletes the command, DMs only me", async () => {
    const t = setup();
    const asha = await makePerson(db, { startedBot: true });
    const me = await makePerson(db, { startedBot: true });
    const chat = group();
    const source = ctx(chat, asha, "the fan in the dome is broken").message;
    const c = ctx(chat, me, "/new_request_for_me", { reply_to_message: source });
    const res = await t.run(silentFor(c, source));

    expect(res.outcome).toBe("request.created");
    const r = await requests.getById(db, systemActor(), res.requestId!);
    expect(r).toMatchObject({ requesterId: asha.id, assigneeId: me.id, body: "the fan in the dome is broken" });
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toMatchObject({ chatId: me.telegramId, requestId: r.id });
    expect(t.sent[0].html).toContain(`#${r.id}`);
    expect(t.sent.some((m) => m.chatId === chat.id)).toBe(false);
    expect(deleted(t.calls)).toEqual([{ chat_id: chat.id, message_id: c.message.message_id }]);
    expect(notifies(res.effects)).toEqual([]);
    expect(res.effects).toContainEqual({ kind: "title", requestId: r.id });
  });

  it("/new_request @bob silently: Bob gets no DM at creation, but later changes notify as usual", async () => {
    const t = setup();
    const me = await makePerson(db, { startedBot: true });
    const bob = await makePerson(db, { startedBot: true });
    const c = ctx(group(), me, `/new_request @${bob.username} chairs`);
    const res = await t.run(requestIntent(c, { assignee: { by: "username", username: bob.username! }, body: "chairs", silent: true }));
    expect(notifies(res.effects)).toEqual([]);
    const done = await requests.setStatus(db, actorFor(bob), res.requestId!, { status: "done" });
    expect(notifies(done.effects).length).toBeGreaterThan(0);
  });

  it("can't DM the sender (never pressed Start): says it in the group instead and keeps the command", async () => {
    const asha = await makePerson(db);
    const me = await makePerson(db);
    const cap = capturingNotifier({ blockedChatIds: [me.telegramId!] });
    const calls: { method: string; body: Record<string, unknown> }[] = [];
    const deps = { notifier: cap.notifier, now: () => NOW, tg: async (method: string, body: Record<string, unknown>) => (calls.push({ method, body }), { ok: true }) };
    const chat = group();
    const source = ctx(chat, asha, "need a ladder").message;
    const c = ctx(chat, me, "/new_request_for_me", { reply_to_message: source });
    const res = await handleIntent(db, silentFor(c, source), deps);
    expect(res.outcome).toBe("request.created");
    expect(cap.sent.at(-1)).toMatchObject({ chatId: chat.id, replyTo: c.message.message_id });
    expect(deleted(calls)).toEqual([]);
  });

  it("pulls in replies sent before the request (from the 3-day buffer), keeping the chain", async () => {
    const t = setup();
    const asha = await makePerson(db);
    const ben = await makePerson(db);
    const me = await makePerson(db, { startedBot: true });
    const chat = group();
    const source = ctx(chat, asha, "projector is flickering").message;
    const r1 = ctx(chat, ben, "since this morning", { reply_to_message: source }).message;
    const r2 = ctx(chat, asha, "yes, the HDMI one", { reply_to_message: r1, message_id: r1.message_id + 1 }).message;
    const noise = ctx(chat, ben, "lunch?").message;
    for (const m of [source, r1, r2, noise]) await chatBuffer.record(db, m as never, NOW);
    const c = ctx(chat, me, "/request", { reply_to_message: source, message_id: r2.message_id + 1 });
    await chatBuffer.record(db, c.message as never, NOW);

    const res = await t.run(requestIntent(c, { requester: { by: "user", user: c.message.reply_to_message!.from! }, assignee: { by: "user", user: c.from }, body: source.text!, source }));
    const d = await requests.getDetail(db, systemActor(), res.requestId!);
    const thread = d.messages.filter((m) => m.kind === "thread");
    expect(thread.map((m) => [m.text, m.fromId, m.replyToMessageId])).toEqual([
      ["since this morning", ben.id, source.message_id],
      ["yes, the HDMI one", asha.id, r1.message_id],
    ]);
    // a later reply to an imported message still chains
    expect(await requests.findRequestByTelegramMessage(db, chat.id, r2.message_id)).toBe(res.requestId);
  });

  it("/log: new message -> a request for me; already tracked -> says so; a reply to a request's message -> joins that thread", async () => {
    const t = setup();
    const asha = await makePerson(db);
    const me = await makePerson(db, { startedBot: true });
    const chat = group();

    const fresh = ctx(chat, asha, "can someone get water").message;
    const c1 = ctx(chat, me, "/log", { reply_to_message: fresh });
    const made = await t.run({ kind: "log", source: fresh, ...c1 });
    expect(made.outcome).toBe("request.created");
    expect(await requests.getById(db, systemActor(), made.requestId!)).toMatchObject({ requesterId: asha.id, assigneeId: me.id });

    t.sent.length = 0;
    const again = await t.run({ kind: "log", source: fresh, ...ctx(chat, me, "/log", { reply_to_message: fresh }) });
    expect(again).toMatchObject({ outcome: "log.already", requestId: made.requestId });
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toMatchObject({ chatId: me.telegramId });

    // a reply to the request's message that the bot only has in the buffer (Telegram drops nested reply_to_message)
    const reply = ctx(chat, asha, "20 litres please", { reply_to_message: fresh }).message;
    await chatBuffer.record(db, reply as never, NOW);
    const shallow = { ...reply, reply_to_message: undefined };
    const joined = await t.run({ kind: "log", source: shallow, ...ctx(chat, me, "/log", { reply_to_message: shallow }) });
    expect(joined).toMatchObject({ outcome: "log.added", requestId: made.requestId });
    expect(await requests.findRequestByTelegramMessage(db, chat.id, reply.message_id)).toBe(made.requestId);
  });

  it("/log without replying to someone: usage by DM, nothing in the group", async () => {
    const t = setup();
    const me = await makePerson(db, { startedBot: true });
    const chat = group();
    const res = await t.run({ kind: "log", source: null, ...ctx(chat, me, "/log") });
    expect(res.outcome).toBe("log.usage");
    expect(t.sent.every((m) => m.chatId === me.telegramId)).toBe(true);
  });
});

describe("/note: a private note from Telegram", () => {
  it("adds to my private note on the thread's request, quietly: DM only, command deleted, nothing on the timeline", async () => {
    const t = setup();
    const me = await makePerson(db, { startedBot: true });
    const chat = group();
    const { request: r } = await makeRequest(db, { assignee: me, chatId: chat.id, messageId: 4242 });
    const c = ctx(chat, me, "/note vendor says Monday");
    const res = await t.run({ kind: "note", requestId: null, replyToMessageId: 4242, text: "vendor says Monday", ...c });
    expect(res).toMatchObject({ outcome: "note.added", requestId: r.id });
    expect(await notes.getMine(db, actorFor(me), r.id)).toBe("vendor says Monday");
    expect(t.sent.map((m) => m.chatId)).toEqual([me.telegramId]);
    expect(t.calls.filter((x) => x.method === "deleteMessage")).toHaveLength(1);
    expect((await audit.listForEntity(db, "request", r.id)).some((a) => a.action.startsWith("note"))).toBe(false);
  });
  it("no request found or no text: usage by DM", async () => {
    const t = setup();
    const me = await makePerson(db, { startedBot: true });
    const res = await t.run({ kind: "note", requestId: null, replyToMessageId: null, text: "hello", ...ctx(group(), me, "/note hello") });
    expect(res.outcome).toBe("note.usage");
    expect(t.sent.every((m) => m.chatId === me.telegramId)).toBe(true);
  });
});

describe("forwards to the bot's DM: ask, then new request or add to one", () => {
  async function forwarded(t: ReturnType<typeof setup>, me: Person, author: Person, text: string) {
    const dm: TgChat = { id: me.telegramId!, type: "private" };
    const c = ctx(dm, me, text, { forward_origin: { type: "user", date: 1, sender_user: user(author) } });
    await t.run({ kind: "forward", ...c });
    return { c, prompt: t.sent.at(-1)! };
  }
  const tap = (t: ReturnType<typeof setup>, me: Person, c: MessageCtx, choice: "new" | number) =>
    t.run({ kind: "forward-choice", choice, callbackQueryId: "cb", from: c.from, message: { message_id: 777, date: 0, chat: c.chat, reply_to_message: c.message } });
  const edits = (t: ReturnType<typeof setup>) => t.calls.filter((x) => x.method === "editMessageText").map((x) => String(x.body.text));

  it("asks, naming who it's from, with New first and my open requests with them as add targets", async () => {
    const t = setup();
    const lucy = await makePerson(db, { firstName: "Lucy" });
    const me = await makePerson(db, { startedBot: true });
    const { request: withLucy } = await makeRequest(db, { requester: lucy, assignee: me, title: "Fix the dome projector" });
    const { request: closed } = await makeRequest(db, { requester: lucy, assignee: me, title: "Old one" });
    await requests.setStatus(db, actorFor(me), closed.id, { status: "done" });
    const { c, prompt } = await forwarded(t, me, lucy, "production team issue");
    expect(prompt).toMatchObject({ chatId: me.telegramId, replyTo: c.message.message_id });
    expect(prompt.html).toContain("Lucy");
    const data = prompt.buttons!.map((b) => ("callback_data" in b ? b.callback_data : ""));
    expect(data[0]).toBe("fw:new");
    expect(data).toContain(`fw:${withLucy.id}`);
    expect(data).not.toContain(`fw:${closed.id}`);
    expect(prompt.buttons!.find((b) => "callback_data" in b && b.callback_data === `fw:${withLucy.id}`)!.text).toContain("Fix the dome projector");
    expect(await requests.findRequestByTelegramMessage(db, c.chat.id, c.message.message_id)).toBeNull();
  });

  it("New: a quiet request from the original author to me; a second tap doesn't make another", async () => {
    const t = setup();
    const lucy = await makePerson(db);
    const me = await makePerson(db, { startedBot: true });
    const { c } = await forwarded(t, me, lucy, "can we have a place to message people");
    const res = await tap(t, me, c, "new");
    expect(res.outcome).toBe("request.created");
    expect(await requests.getById(db, systemActor(), res.requestId!)).toMatchObject({ requesterId: lucy.id, assigneeId: me.id, body: "can we have a place to message people" });
    expect(res.effects.filter((e) => e.kind === "notify")).toEqual([]);
    expect(edits(t).at(-1)).toContain(`#${res.requestId}`);
    const again = await tap(t, me, c, "new");
    expect(again).toMatchObject({ outcome: "request.duplicate", requestId: res.requestId });
  });

  it("Add to #N: appends it to that request", async () => {
    const t = setup();
    const lucy = await makePerson(db);
    const me = await makePerson(db, { startedBot: true });
    const { request: r } = await makeRequest(db, { requester: lucy, assignee: me });
    const { c } = await forwarded(t, me, lucy, "and the HDMI cable is missing");
    const res = await tap(t, me, c, r.id);
    expect(res).toMatchObject({ outcome: "append.added", requestId: r.id });
    expect((await requests.getById(db, systemActor(), r.id)).body).toContain("and the HDMI cable is missing");
    expect(edits(t).at(-1)).toContain(`#${r.id}`);
  });

  it("the forward was deleted before the tap: says so", async () => {
    const t = setup();
    const me = await makePerson(db, { startedBot: true });
    const dm: TgChat = { id: me.telegramId!, type: "private" };
    const res = await t.run({ kind: "forward-choice", choice: "new", callbackQueryId: "cb", from: user(me), message: { message_id: 5, date: 0, chat: dm } });
    expect(res.outcome).toBe("forward.gone");
  });
});
