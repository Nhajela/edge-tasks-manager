/**
 * Titler hook called by runEffects after create/append. STUB: the AI agent replaces the body with the OpenRouter
 * titler (src/lib/ai/titler.ts), keeping this signature. Without an AI it marks the request "skipped" so the
 * heuristic title stays.
 */
import { db as defaultDb } from "@/db";
import { aiActor } from "@/lib/actor";
import * as requests from "./requests";
import type { DbClient } from "./types";

export async function titleRequest(requestId: number, db: DbClient = defaultDb()): Promise<void> {
  await requests.setAiState(db, aiActor(), requestId, { aiStatus: "skipped" });
}
