import { and, desc, eq } from "drizzle-orm";
import { botMessages } from "@/db/schema";
import type { DbClient } from "./types";

export type BotMessage = typeof botMessages.$inferSelect;

/**
 * Record a bot send attempt. bot_messages is itself a delivery log (not a business mutation), so no audit row.
 * request_id ties the message to a request, so replies to it thread into that request.
 */
export async function log(
  db: DbClient,
  m: {
    chatId: number;
    kind: string;
    ok: boolean;
    text: string;
    telegramMessageId?: number | null;
    error?: string | null;
    requestId?: number | null;
    data?: Record<string, unknown> | null;
  },
): Promise<BotMessage> {
  const [row] = await db
    .insert(botMessages)
    .values({
      chatId: m.chatId,
      kind: m.kind,
      ok: m.ok,
      text: m.text,
      telegramMessageId: m.telegramMessageId ?? null,
      error: m.error ?? null,
      requestId: m.requestId ?? null,
      data: m.data ?? null,
    })
    .returning();
  return row;
}

/** The bot message with this Telegram id in this chat (e.g. a pending "What should @bob do?" prompt). */
export async function find(db: DbClient, chatId: number, telegramMessageId: number): Promise<BotMessage | null> {
  const [row] = await db
    .select()
    .from(botMessages)
    .where(and(eq(botMessages.chatId, chatId), eq(botMessages.telegramMessageId, telegramMessageId)))
    .orderBy(desc(botMessages.id))
    .limit(1);
  return row ?? null;
}
