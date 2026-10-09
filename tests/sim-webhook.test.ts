import { describe, expect, it } from "vitest";
import { CHAT, SCENARIOS as ALL } from "../scripts/sim-webhook.mjs";

type Ent = { type: string; offset: number; length: number; user?: { id: number } };
type Msg = {
  message_id: number;
  chat: { id: number };
  from: { id: number; is_bot: boolean };
  text?: string;
  caption?: string;
  entities?: Ent[];
  caption_entities?: Ent[];
  photo?: unknown[];
  reply_to_message?: Msg;
};

/** Runs a scenario with a fake transport: the bot "replies" to everything with a #42 confirmation. */
async function run(name: string) {
  const sent: Msg[] = [];
  let botId = 5000;
  await SCENARIOS[name]({
    send: async (m: Msg) => void sent.push(m),
    reply: async () => ({ messageId: botId++, text: "📝 #42 for @ben: something" }),
  });
  return sent;
}

type Sim = { send: (m: Msg) => Promise<void>; reply: () => Promise<{ messageId: number; text: string }> };
const SCENARIOS = ALL as Record<string, (sim: Sim) => Promise<void>>;

const fakeId = (id: number) => expect(String(id)).toMatch(/^91000000\d\d$/);

describe("sim-webhook scenarios", () => {
  for (const name of Object.keys(SCENARIOS)) {
    it(`${name}: well-formed fake updates`, async () => {
      const sent = await run(name);
      expect(sent.length).toBeGreaterThan(0);
      for (const m of [...sent, ...sent.map((s) => s.reply_to_message).filter(Boolean)] as Msg[]) {
        fakeId(m.from.id);
        expect(m.chat.id).toBe(CHAT.id);
        const text = m.text ?? m.caption ?? "";
        for (const e of m.entities ?? m.caption_entities ?? []) {
          const token = text.slice(e.offset, e.offset + e.length);
          if (e.type === "bot_command") expect(token).toMatch(/^\/\w+(@\w+)?$/);
          if (e.type === "mention") expect(token).toMatch(/^@\w+$/);
          if (e.type === "text_mention") fakeId(e.user!.id);
        }
      }
      expect(new Set(sent.map((m) => m.message_id)).size).toBe(sent.length);
    });
  }

  it("thread-chain replies form the SPEC chain", async () => {
    const [cmd, a1, b1, a2, c1] = await run("thread-chain");
    expect(cmd.text).toMatch(/^\/request @ben /);
    expect(a1.reply_to_message!.from.is_bot).toBe(true);
    expect(b1.reply_to_message!.message_id).toBe(a1.message_id);
    expect(a2.reply_to_message!.message_id).toBe(b1.message_id);
    expect(c1.reply_to_message!.message_id).toBe(b1.message_id);
  });

  it("append uses the request id from the confirmation", async () => {
    const sent = await run("append");
    expect(sent.map((m) => m.text)).toContain("/add 42");
  });

  it("photo scenario carries a caption command and photo sizes", async () => {
    const [first] = await run("photo");
    expect(first.caption).toMatch(/^\/request @ben/);
    expect(first.caption_entities![0]).toMatchObject({ type: "bot_command", offset: 0, length: 8 });
    expect(first.photo).toHaveLength(3);
  });
});
