/**
 * The bits of /context and the /r/[id] AI question card that combine two services. No "use server": the
 * actions in ./actions.ts resolve the viewer and call these, and tests call them directly.
 */
import type { DbClient } from "@/db";
import * as aiContext from "@/services/aiContext";
import { NotFoundError } from "@/services/errors";
import * as requests from "@/services/requests";
import type { Actor } from "@/services/types";

// ponytail: list() + find is a full table scan of ai_context; add aiContext.getById if this grows past a few hundred rows.
async function findQuestion(db: DbClient, actor: Actor, by: { questionId?: number; requestId?: number }) {
  const items = await aiContext.list(db, actor, { kind: "question" });
  if (by.questionId != null) return items.find((i) => i.id === by.questionId);
  return items.findLast((i) => i.requestId === by.requestId && i.status === "open");
}

/** The card goes away once its question is handled, unless the titler has since asked something newer. */
async function clearCard(db: DbClient, actor: Actor, q: { requestId: number | null; text: string }) {
  if (q.requestId == null) return;
  const r = await requests.getById(db, actor, q.requestId);
  if (r.aiQuestion === q.text) await requests.setAiState(db, actor, q.requestId, { aiQuestion: null });
}

/**
 * Answer by question id (/context) or by request id (/r/[id]). If the request carries a question that never made it
 * into ai_context, `question` records it first so the answer still feeds the titler.
 */
export async function answerQuestion(
  db: DbClient,
  actor: Actor,
  input: { questionId?: number; requestId?: number; question?: string | null; text: string },
): Promise<{ requestId: number | null }> {
  let q = await findQuestion(db, actor, input);
  if (!q && input.requestId != null && input.question)
    q = await aiContext.addQuestion(db, actor, { text: input.question, requestId: input.requestId });
  if (!q) throw new NotFoundError("That question is gone.");
  const answered = await aiContext.answer(db, actor, q.id, input.text);
  await clearCard(db, actor, answered);
  return { requestId: answered.requestId };
}

export async function dismissQuestion(db: DbClient, actor: Actor, questionId: number): Promise<void> {
  const q = await aiContext.dismiss(db, actor, questionId);
  await clearCard(db, actor, q);
}
