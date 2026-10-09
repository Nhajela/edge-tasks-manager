/**
 * Titler hook called by runEffects after create/append. STUB: the AI task replaces the body with the OpenRouter
 * titler (src/lib/ai/titler.ts), keeping this signature. Without an AI it marks the request "skipped" so the
 * heuristic title stays. Writes go through requests.setTitle/setPriority/setDue/setAiState as aiActor(), which
 * respect the human lock flags.
 */
import { aiActor } from "@/lib/actor";
import * as requests from "./requests";
import type { DbClient } from "./types";

export type TitlerDeps = {
  /** injectable for tests (the OpenRouter call) */
  fetch?: typeof fetch;
  now?: () => Date;
  /** default OPENROUTER_API_KEY; null/empty = no AI (heuristic title stays) */
  apiKey?: string | null;
  /** default OPENROUTER_MODEL */
  model?: string;
};

export async function titleRequest(db: DbClient, requestId: number, deps: TitlerDeps = {}): Promise<void> {
  void deps;
  await requests.setAiState(db, aiActor(), requestId, { aiStatus: "skipped" });
}
