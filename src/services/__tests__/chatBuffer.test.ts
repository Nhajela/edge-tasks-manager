import { describe, expect, it } from "vitest";
import { testDb } from "@tests/helpers/db";
import { fakeChatId } from "@tests/factories";
import * as chatBuffer from "../chatBuffer";

const db = testDb();
const NOW = new Date("2026-10-12T06:00:00Z");
const msg = (chatId: number, id: number, replyTo?: number, text = `m${id}`) => ({
  message_id: id,
  date: 0,
  chat: { id: chatId, type: "supergroup" },
  text,
  ...(replyTo ? { reply_to_message: { message_id: replyTo, date: 0, chat: { id: chatId, type: "supergroup" } } } : {}),
});

describe("chatBuffer", () => {
  it("returns the whole reply tree under a message, oldest first, and nothing from other chats", async () => {
    const chat = fakeChatId();
    const other = fakeChatId();
    // 10 <- 11 <- 13, 10 <- 12, 14 unrelated; same ids in another chat
    for (const m of [msg(chat, 10), msg(chat, 11, 10), msg(chat, 12, 10), msg(chat, 13, 11), msg(chat, 14), msg(other, 11, 10)])
      await chatBuffer.record(db, m, NOW);
    await chatBuffer.record(db, msg(chat, 11, 10, "retry"), NOW); // a Telegram redelivery is ignored

    const tree = await chatBuffer.repliesTo(db, chat, 10, NOW);
    expect(tree.map((m) => m.message_id)).toEqual([11, 12, 13]);
    expect(tree[0].text).toBe("m11");
    expect((await chatBuffer.get(db, chat, 13))?.reply_to_message?.message_id).toBe(11);
    expect(await chatBuffer.get(db, chat, 99)).toBeNull();
  });

  it("forgets messages older than 3 days", async () => {
    const chat = fakeChatId();
    const old = new Date(NOW.getTime() - 4 * 24 * 3600_000);
    await chatBuffer.record(db, msg(chat, 20), old);
    await chatBuffer.record(db, msg(chat, 21, 20), old);
    await chatBuffer.record(db, msg(chat, 22, 20), NOW);
    expect((await chatBuffer.repliesTo(db, chat, 20, NOW)).map((m) => m.message_id)).toEqual([22]);
    await chatBuffer.purge(db, NOW);
    expect(await chatBuffer.get(db, chat, 21)).toBeNull();
    expect(await chatBuffer.get(db, chat, 22)).not.toBeNull();
  });
});
