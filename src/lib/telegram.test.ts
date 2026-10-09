import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: () => ({}) }));
vi.mock("@/services/botMessages", () => ({ log: vi.fn() }));
vi.mock("@/services/people", () => ({ setStartedBot: vi.fn() }));

describe("telegramNotifier: the done photo", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function send(photo: { fileId: string } | null, reply: (method: string) => unknown) {
    vi.stubEnv("TELEGRAM_SEND_IN_DEV", "1");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
    vi.stubEnv("NODE_ENV", "production"); // skip the dev outbox file
    const calls: { method: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
      const method = url.split("/").pop()!;
      calls.push({ method, body: JSON.parse(init.body) });
      return { json: async () => reply(method) };
    });
    const { telegramNotifier } = await import("./telegram");
    const res = await telegramNotifier.send({ chatId: 9100000001, kind: "status", html: "✅ #12 is done", photo });
    return { res, calls };
  }

  it("sends a photo with the html as its caption", async () => {
    const { res, calls } = await send({ fileId: "AgAD" }, () => ({ ok: true, result: { message_id: 7 } }));
    expect(res).toEqual({ ok: true, messageId: 7 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "sendPhoto", body: { chat_id: 9100000001, photo: "AgAD", caption: "✅ #12 is done", parse_mode: "HTML" } });
    expect(calls[0].body).not.toHaveProperty("text");
  });

  it("a rejected photo still sends the text", async () => {
    const { res, calls } = await send({ fileId: "gone" }, (m) =>
      m === "sendPhoto" ? { ok: false, error_code: 400, description: "Bad Request: wrong file identifier" } : { ok: true, result: { message_id: 8 } },
    );
    expect(res).toEqual({ ok: true, messageId: 8 });
    expect(calls.map((c) => c.method)).toEqual(["sendPhoto", "sendMessage"]);
    expect(calls[1].body).toMatchObject({ text: "✅ #12 is done" });
  });

  it("no photo: a plain sendMessage", async () => {
    const { calls } = await send(null, () => ({ ok: true, result: { message_id: 9 } }));
    expect(calls.map((c) => c.method)).toEqual(["sendMessage"]);
  });
});
