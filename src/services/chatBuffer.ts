import { and, asc, eq, gte, lt } from "drizzle-orm";
import { chatBuffer } from "@/db/schema";
import type { DbClient } from "./types";

/** Raw Telegram message as stored; callers cast to their own TgMessage type. */
export type BufferedMessage = { message_id: number; reply_to_message?: { message_id: number } } & Record<string, unknown>;

export const BUFFER_MS = 3 * 24 * 3600_000;

/**
 * Remember a group message for 3 days (SPEC "Message buffer"), so a request made later from it can pull in the replies
 * that came first. A cache, not domain state: no audit row. Redeliveries are ignored.
 */
export async function record(db: DbClient, message: BufferedMessage & { chat: { id: number } }, now = new Date()) {
  await db
    .insert(chatBuffer)
    .values({
      createdAt: now,
      chatId: message.chat.id,
      messageId: message.message_id,
      replyToMessageId: message.reply_to_message?.message_id ?? null,
      message,
    })
    .onConflictDoNothing();
  // ponytail: purge piggybacks on roughly 1 in 50 messages; move to a cron if traffic makes this table big
  if (message.message_id % 50 === 0) await purge(db, now);
}

export async function purge(db: DbClient, now = new Date()) {
  await db.delete(chatBuffer).where(lt(chatBuffer.createdAt, new Date(now.getTime() - BUFFER_MS)));
}

export async function get(db: DbClient, chatId: number, messageId: number): Promise<BufferedMessage | null> {
  const [row] = await db
    .select({ message: chatBuffer.message })
    .from(chatBuffer)
    .where(and(eq(chatBuffer.chatId, chatId), eq(chatBuffer.messageId, messageId)));
  return (row?.message as BufferedMessage | undefined) ?? null;
}

/** Every buffered reply under `messageId`, at any depth, oldest first (the root itself is not included). */
export async function repliesTo(db: DbClient, chatId: number, messageId: number, now = new Date()): Promise<BufferedMessage[]> {
  const rows = await db
    .select({ messageId: chatBuffer.messageId, replyTo: chatBuffer.replyToMessageId, message: chatBuffer.message })
    .from(chatBuffer)
    .where(and(eq(chatBuffer.chatId, chatId), gte(chatBuffer.createdAt, new Date(now.getTime() - BUFFER_MS))))
    .orderBy(asc(chatBuffer.messageId));
  const inTree = new Set([messageId]);
  // ids only grow, so one pass in id order sees every parent before its replies
  return rows.filter((r) => r.replyTo != null && inTree.has(r.replyTo) && inTree.add(r.messageId)).map((r) => r.message as BufferedMessage);
}
