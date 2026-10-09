import { and, eq, gt, isNull } from "drizzle-orm";
import { pendingPrompts } from "@/db/schema";
import type { PendingPrompt } from "@/lib/types";
import * as audit from "./audit";
import type { Actor, DbClient } from "./types";

export const PROMPT_TTL_MS = 3600_000;

export type PromptInput = {
  chatId: number;
  /** the bot's "What should @bob do?" message id */
  promptMessageId: number;
  requesterId: number;
  assigneeId: number;
  sourceMessageId?: number | null;
  chatTitle?: string | null;
  now?: Date;
};

/** Remember a "What should @bob do?" prompt (after the bot sent it) so the reply to it can become the request. */
export async function create(db: DbClient, actor: Actor, input: PromptInput): Promise<PendingPrompt> {
  const now = input.now ?? new Date();
  const [row] = await db
    .insert(pendingPrompts)
    .values({
      chatId: input.chatId,
      promptMessageId: input.promptMessageId,
      requesterId: input.requesterId,
      assigneeId: input.assigneeId,
      createdById: actor.personId,
      sourceMessageId: input.sourceMessageId ?? null,
      chatTitle: input.chatTitle ?? null,
      expiresAt: new Date(now.getTime() + PROMPT_TTL_MS),
    })
    .returning();
  await audit.record(db, actor, {
    action: "prompt.create",
    entityType: "prompt",
    entityId: row.id,
    data: { chatId: row.chatId, promptMessageId: row.promptMessageId, assigneeId: row.assigneeId },
  });
  return row;
}

/**
 * A reply to a prompt: claims it atomically (one statement, so a Telegram retry or a second reply gets null).
 * Only the actor who mentioned the bot can claim it. Returns null otherwise or when there is no live prompt for
 * that message. The caller then runs requests.create.
 */
export async function consume(
  db: DbClient,
  actor: Actor,
  input: { chatId: number; promptMessageId: number; now?: Date },
): Promise<PendingPrompt | null> {
  const now = input.now ?? new Date();
  const [row] = await db
    .update(pendingPrompts)
    .set({ consumedAt: now })
    .where(
      and(
        eq(pendingPrompts.chatId, input.chatId),
        eq(pendingPrompts.promptMessageId, input.promptMessageId),
        eq(pendingPrompts.requesterId, actor.personId ?? -1),
        isNull(pendingPrompts.consumedAt),
        gt(pendingPrompts.expiresAt, now),
      ),
    )
    .returning();
  if (!row) return null;
  await audit.record(db, actor, { action: "prompt.consume", entityType: "prompt", entityId: row.id });
  return row;
}

/** The prompt behind a bot message, live or not (so a late reply can be told it expired). */
export async function find(db: DbClient, chatId: number, promptMessageId: number): Promise<PendingPrompt | null> {
  const [row] = await db
    .select()
    .from(pendingPrompts)
    .where(and(eq(pendingPrompts.chatId, chatId), eq(pendingPrompts.promptMessageId, promptMessageId)));
  return row ?? null;
}

/** The prompt a "@bot @bob" message already produced (a Telegram redelivery must not ask twice). */
export async function findBySource(db: DbClient, chatId: number, sourceMessageId: number): Promise<PendingPrompt | null> {
  const [row] = await db
    .select()
    .from(pendingPrompts)
    .where(and(eq(pendingPrompts.chatId, chatId), eq(pendingPrompts.sourceMessageId, sourceMessageId)));
  return row ?? null;
}
