import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  afters: [] as (() => unknown)[],
  parseUpdate: vi.fn(),
  handleIntent: vi.fn(),
  handleCallback: vi.fn(),
  handleStart: vi.fn(),
  handleMembership: vi.fn(),
  runEffects: vi.fn(),
  record: vi.fn(async () => {}),
}));

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => m.afters.push(fn) }));
vi.mock("@/db", () => ({ db: () => "DB" }));
vi.mock("@/lib/telegram", () => ({ telegramNotifier: { send: vi.fn() } }));
vi.mock("@/lib/bot/parse", () => ({ parseUpdate: m.parseUpdate }));
vi.mock("@/lib/bot/handlers", () => ({ handleIntent: m.handleIntent }));
vi.mock("@/lib/bot/callbacks", () => ({ handleCallback: m.handleCallback, handleStart: m.handleStart }));
vi.mock("@/lib/bot/membership", () => ({ handleMembership: m.handleMembership }));
vi.mock("@/lib/effects", () => ({ runEffects: m.runEffects }));
vi.mock("@/services/chatBuffer", () => ({ record: m.record }));

const { POST } = await import("./route");

const SECRET = "test-webhook-secret";
const post = (body: unknown, secret: string | null = SECRET) =>
  POST(
    new NextRequest("http://localhost/api/telegram", {
      method: "POST",
      headers: secret ? { "x-telegram-bot-api-secret-token": secret } : {},
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
const effect = { kind: "title", requestId: 7 } as const;
const msg = { message_id: 1, date: 0, chat: { id: -1, type: "group" }, from: { id: 9100000001, first_name: "A" }, text: "/mine" };

beforeEach(() => {
  vi.clearAllMocks();
  m.afters.length = 0;
  process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
});

describe("POST /api/telegram", () => {
  it("rejects a missing or wrong secret without parsing", async () => {
    expect((await post({ message: msg }, null)).status).toBe(401);
    expect((await post({ message: msg }, "wrong")).status).toBe(401);
    expect((await post({ message: msg }, SECRET + "x")).status).toBe(401);
    expect(m.parseUpdate).not.toHaveBeenCalled();
  });

  it("rejects everything when no secret is configured", async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    expect((await post({ message: msg }, "")).status).toBe(401);
  });

  it("parses, handles, and runs effects after the response", async () => {
    const intent = { kind: "list", command: "mine" };
    m.parseUpdate.mockReturnValue(intent);
    m.handleIntent.mockResolvedValue({ outcome: "list", effects: [effect] });
    const res = await post({ update_id: 1, message: msg });
    expect(res.status).toBe(200);
    expect(m.parseUpdate).toHaveBeenCalledWith({ update_id: 1, message: msg }, expect.objectContaining({ superadminUsername: expect.any(String) }));
    expect(m.handleIntent).toHaveBeenCalledWith("DB", intent, expect.objectContaining({ notifier: expect.anything() }));
    expect(m.runEffects).not.toHaveBeenCalled();
    // effects, then the group message into the 3-day buffer
    expect(m.afters).toHaveLength(2);
    await m.afters[0]();
    expect(m.runEffects).toHaveBeenCalledWith([effect]);
    await m.afters[1]();
    expect(m.record).toHaveBeenCalledWith("DB", msg);
  });

  it("no effects: only buffers group messages; DMs and bots are never buffered", async () => {
    m.parseUpdate.mockReturnValue({ kind: "ignore", reason: "x" });
    m.handleIntent.mockResolvedValue({ outcome: "ignored", effects: [] });
    await post({ update_id: 1, message: msg });
    expect(m.afters).toHaveLength(1);
    m.afters.length = 0;
    await post({ update_id: 2, message: { ...msg, chat: { id: 9100000001, type: "private" } } });
    await post({ update_id: 3, message: { ...msg, from: { id: 1, first_name: "B", is_bot: true } } });
    expect(m.afters).toHaveLength(0);
  });

  it("sends /start to the login flow", async () => {
    const intent = { kind: "start", code: "abc" };
    m.parseUpdate.mockReturnValue(intent);
    m.handleStart.mockResolvedValue({ outcome: "start.login-prompt", effects: [] });
    await post({ update_id: 1, message: msg });
    expect(m.handleStart).toHaveBeenCalledWith("DB", intent);
    expect(m.handleIntent).not.toHaveBeenCalled();
  });

  it("routes callback queries and my_chat_member without parsing", async () => {
    const cb = { id: "q", from: { id: 9100000002 }, data: "st:1:done" };
    m.handleCallback.mockResolvedValue([effect]);
    await post({ update_id: 2, callback_query: cb });
    expect(m.handleCallback).toHaveBeenCalledWith("DB", cb);
    expect(m.afters).toHaveLength(1);

    const mcm = { chat: { id: -5, type: "group" }, from: { id: 1 }, date: 0, old_chat_member: {}, new_chat_member: { status: "member" } };
    m.handleMembership.mockResolvedValue([]);
    await post({ update_id: 3, my_chat_member: mcm });
    expect(m.handleMembership).toHaveBeenCalledWith("DB", mcm);
    expect(m.parseUpdate).not.toHaveBeenCalled();
  });

  it("always answers 200 on handler errors and bad JSON", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.parseUpdate.mockReturnValue({ kind: "list" });
    m.handleIntent.mockRejectedValue(new Error("boom"));
    expect((await post({ update_id: 1, message: msg })).status).toBe(200);
    m.parseUpdate.mockImplementation(() => {
      throw new Error("bad update");
    });
    expect((await post("{not json")).status).toBe(200);
  });
});
