/** Bot callbacks (/start login, "Yes, log me in", assignee status buttons) and my_chat_member, against the test DB. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actorFor, fakeTelegramId, makePerson, makeRequest, uniqueName } from "@tests/factories";
import { testDb } from "@tests/helpers/db";

const tgMock = vi.hoisted(() => ({ tg: vi.fn(), sendMessage: vi.fn() }));
vi.mock("@/lib/telegram", async (orig) => ({ ...(await orig<typeof import("@/lib/telegram")>()), ...tgMock }));

const { handleCallback, handleStart, parseStatusData } = await import("@/lib/bot/callbacks");
const { handleMembership } = await import("@/lib/bot/membership");
const { createCode, redeemCode } = await import("@/lib/login");
const audit = await import("@/services/audit");
const people = await import("@/services/people");
const requests = await import("@/services/requests");

const db = testDb();
const user = (id: number, username?: string) => ({ id, first_name: "Asha", username });
const dm = (chatId: number, text = "📝 Ben asked you: fix it (#1)") => ({ message_id: 77, date: 0, chat: { id: chatId, type: "private" as const }, text });
const tgCalls = (method: string) => tgMock.tg.mock.calls.filter((c) => c[0] === method).map((c) => c[1]);

beforeEach(() => {
  vi.clearAllMocks();
  tgMock.tg.mockResolvedValue({ ok: true });
  tgMock.sendMessage.mockResolvedValue({ ok: true, messageId: 1 });
});

describe("parseStatusData", () => {
  it("reads st:<id>:<status> for the two button statuses only", () => {
    expect(parseStatusData("st:12:done")).toEqual({ requestId: 12, status: "done" });
    expect(parseStatusData("st:3:in_progress")).toEqual({ requestId: 3, status: "in_progress" });
    expect(parseStatusData("st:3:declined")).toBeNull();
    expect(parseStatusData("login:abc")).toBeNull();
    expect(parseStatusData(undefined)).toBeNull();
  });
});

describe("/start", () => {
  it("with a pending site code asks for an explicit 'Yes, log me in' tap", async () => {
    const id = fakeTelegramId();
    const code = await createCode();
    const res = await handleStart(db, { kind: "start", code, message: dm(id), chat: dm(id).chat, from: user(id, uniqueName("u")) });
    expect(res.outcome).toBe("start.login-prompt");
    const [chatId, html, buttons] = tgMock.sendMessage.mock.calls[0];
    expect(chatId).toBe(String(id));
    expect(html).toContain("Log in to Edge Tasks");
    expect(buttons).toEqual([{ text: "✅ Yes, log me in", callback_data: `login:${code}` }]);
    expect((await people.findByTelegramId(db, id))?.startedBot).toBe(true);
  });

  it("without a code (or an expired one) sends a welcome with a working magic link", async () => {
    const id = fakeTelegramId();
    for (const code of [null, "nope-expired"]) {
      tgMock.sendMessage.mockClear();
      const res = await handleStart(db, { kind: "start", code, message: dm(id), chat: dm(id).chat, from: user(id) });
      expect(res.outcome).toBe(code ? "start.expired" : "start.welcome");
      const [, html, [button]] = tgMock.sendMessage.mock.calls[0];
      expect(html).toContain(code ? "expired" : "Hey Asha");
      expect(html).toContain("@username"); // no username: nudge
      const magic = new URL(button.url).searchParams.get("code")!;
      const state = await redeemCode(magic);
      expect(state).toMatchObject({ status: "ok", session: { telegramId: String(id) } });
    }
  });
});

describe("login callback", () => {
  it("claims the code, answers, and edits the prompt", async () => {
    const id = fakeTelegramId();
    const code = await createCode();
    expect(await handleCallback(db, { id: "q1", from: user(id, uniqueName("u")), data: `login:${code}`, message: dm(id) })).toEqual([]);
    expect(tgCalls("answerCallbackQuery")[0]).toMatchObject({ callback_query_id: "q1", text: expect.stringContaining("Logged in") });
    expect(tgCalls("editMessageText")[0]).toMatchObject({ chat_id: id, message_id: 77 });
    expect(await redeemCode(code)).toMatchObject({ status: "ok", session: { telegramId: String(id) } });
    expect((await people.findByTelegramId(db, id))?.startedBot).toBe(true);
  });

  it("an expired/used code sends a fresh login link instead", async () => {
    const id = fakeTelegramId();
    await handleCallback(db, { id: "q2", from: user(id), data: "login:unknown-code", message: dm(id) });
    expect(tgCalls("answerCallbackQuery")[0].text).toContain("expired");
    expect(tgCalls("editMessageText")).toHaveLength(0);
    expect(tgMock.sendMessage.mock.calls[0][2][0].url).toContain("/login?code=");
  });

  it("unknown callback data is just acknowledged", async () => {
    await handleCallback(db, { id: "q3", from: user(fakeTelegramId()), data: "whatever" });
    expect(tgMock.tg).toHaveBeenCalledWith("answerCallbackQuery", { callback_query_id: "q3" });
  });
});

describe("assignee status buttons", () => {
  const statusRows = async (id: number) => (await audit.listForEntity(db, "request", id)).filter((a) => a.action === "request.status");

  it("'On it' then 'Done' set the status via the service, edit the DM, and return notifications", async () => {
    const { request, assignee } = await makeRequest(db);
    const from = user(Number(assignee.telegramId), assignee.username!);

    const onIt = await handleCallback(db, { id: "a", from, data: `st:${request.id}:in_progress`, message: dm(from.id) });
    expect(onIt).toEqual([]); // requester can't be DMed and "doing" isn't group-worthy
    expect((await requests.getById(db, actorFor(assignee), request.id)).status).toBe("in_progress");
    const edit1 = tgCalls("editMessageText")[0];
    expect(edit1.text).toContain("on it");
    expect(edit1.reply_markup.inline_keyboard[0][0]).toEqual({ text: "✅ Done", callback_data: `st:${request.id}:done` });

    const done = await handleCallback(db, { id: "b", from, data: `st:${request.id}:done`, message: dm(from.id) });
    expect(done).toEqual([expect.objectContaining({ kind: "notify", message: expect.objectContaining({ kind: "group_fallback" }) })]);
    expect((await requests.getById(db, actorFor(assignee), request.id)).status).toBe("done");
    expect(tgCalls("answerCallbackQuery").at(-1).text).toContain("done");
    expect(await statusRows(request.id)).toHaveLength(2);
  });

  it("a double tap writes no second audit row", async () => {
    const { request, assignee } = await makeRequest(db);
    const cb = { id: "c", from: user(Number(assignee.telegramId)), data: `st:${request.id}:done`, message: dm(1) };
    await handleCallback(db, cb);
    expect(await handleCallback(db, cb)).toEqual([]);
    expect(await statusRows(request.id)).toHaveLength(1);
  });

  it("only the assignee can use them", async () => {
    const { request, requester } = await makeRequest(db);
    await handleCallback(db, { id: "d", from: user(Number(requester.telegramId)), data: `st:${request.id}:done`, message: dm(1) });
    expect(tgCalls("answerCallbackQuery")[0].text).toContain("Only the assignee");
    expect((await requests.getById(db, actorFor(requester), request.id)).status).toBe("open");
    expect(await statusRows(request.id)).toHaveLength(0);

    const stranger = await makePerson(db);
    await handleCallback(db, { id: "e", from: user(Number(stranger.telegramId)), data: `st:${request.id}:done` });
    expect(tgCalls("answerCallbackQuery")[1].text).toMatch(/people on this request/);
  });

  it("an unknown request id is answered, not thrown", async () => {
    await handleCallback(db, { id: "f", from: user(fakeTelegramId()), data: "st:999999999:done" });
    expect(tgCalls("answerCallbackQuery")[0].text).toBeTruthy();
  });
});

describe("my_chat_member", () => {
  const adminId = fakeTelegramId();
  let saved: string | undefined;
  beforeEach(async () => {
    saved = process.env.SUPERADMIN_TELEGRAM_ID;
    process.env.SUPERADMIN_TELEGRAM_ID = String(adminId);
    await makePerson(db, { telegramId: adminId });
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.SUPERADMIN_TELEGRAM_ID;
    else process.env.SUPERADMIN_TELEGRAM_ID = saved;
  });

  const added = (status: string) => ({
    chat: { id: -1009100000042, type: "supergroup" as const, title: "Volunteers <3" },
    from: user(fakeTelegramId(), "bob"),
    date: 0,
    old_chat_member: { status: "left", user: user(1) },
    new_chat_member: { status, user: user(1) },
  });

  it("DMs the superadmin the chat id, with a warning when the bot can't read all messages", async () => {
    const [e] = await handleMembership(db, added("member"), { getMe: async () => ({ can_read_all_group_messages: false }) });
    expect(e).toMatchObject({ kind: "notify", message: { chatId: adminId, kind: "admin_ping" } });
    const html = e.kind === "notify" ? e.message.html : "";
    expect(html).toContain("<code>-1009100000042</code>");
    expect(html).toContain("Volunteers &lt;3");
    expect(html).toContain("/setprivacy");
  });

  it("no warning when privacy is off, the bot is admin, or getMe is unknown", async () => {
    for (const [status, me] of [
      ["member", { can_read_all_group_messages: true }],
      ["administrator", { can_read_all_group_messages: false }],
      ["member", null],
    ] as const) {
      const [e] = await handleMembership(db, added(status), { getMe: async () => me });
      expect(e.kind === "notify" && e.message.html).not.toContain("/setprivacy");
    }
  });

  it("ignores private chats", async () => {
    const u = { ...added("member"), chat: { id: 5, type: "private" as const } };
    expect(await handleMembership(db, u, { getMe: async () => null })).toEqual([]);
  });
});
