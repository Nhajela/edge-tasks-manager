/**
 * Titler hook called by runEffects after create/append. Asks the model (src/lib/ai/titler.ts) for a title, priority,
 * due date and an optional question, then writes them as aiActor() through the request services, which skip fields a
 * human has locked. No key → "skipped"; any error → "failed" (the heuristic title stays).
 */
import { aiActor } from "@/lib/actor";
import { DEFAULT_MODEL, generateTitle } from "@/lib/ai/titler";
import { escapeHtml } from "@/lib/html";
import { displayName } from "@/lib/names";
import type { Person, Request } from "@/lib/types";
import * as aiContext from "./aiContext";
import { requestUrl } from "./notifications";
import * as people from "./people";
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
  /** default lib/telegram tg(): edits the bot's "#12 created" message */
  tg?: (method: string, body: Record<string, unknown>) => Promise<unknown>;
};

/** The bot's "📝 #12 for @bob: title" confirmation. The bot handler should send this same message so edits match. */
export function confirmationMessage(request: Pick<Request, "id" | "title">, assignee: Pick<Person, "username" | "firstName"> | null) {
  return {
    html: `📝 <b>#${request.id}</b> for ${escapeHtml(displayName(assignee))}: ${escapeHtml(request.title)}`,
    buttons: [{ text: "Open the dashboard", url: requestUrl(request.id) }],
  };
}

export async function titleRequest(db: DbClient, requestId: number, deps: TitlerDeps = {}): Promise<void> {
  const actor = aiActor();
  const apiKey = deps.apiKey === undefined ? process.env.OPENROUTER_API_KEY : deps.apiKey;
  if (!apiKey) {
    await requests.setAiState(db, actor, requestId, { aiStatus: "skipped" });
    return;
  }

  const before = await requests.getById(db, actor, requestId);
  const [requester, assignee] = await Promise.all([people.getById(db, before.requesterId), people.getById(db, before.assigneeId)]);

  let out;
  try {
    out = await generateTitle(
      {
        body: before.body,
        requester: displayName(requester),
        assignee: displayName(assignee),
        chatTitle: before.chatTitle,
        now: (deps.now ?? (() => new Date()))(),
        items: await aiContext.promptItems(db),
      },
      { fetch: deps.fetch, apiKey, model: deps.model || process.env.OPENROUTER_MODEL || DEFAULT_MODEL },
    );
  } catch (err) {
    console.error(`titler #${requestId} failed`, err);
    await requests.setAiState(db, actor, requestId, { aiStatus: "failed" });
    return;
  }

  // only touch what differs, so the timeline isn't padded with no-op AI rows
  const titled = out.title !== before.title && (await requests.setTitle(db, actor, requestId, out.title)).changed;
  if (out.priority !== before.priority) await requests.setPriority(db, actor, requestId, out.priority);
  // a null due from the model never clears a due someone already set
  if (out.dueAt && out.dueAt.getTime() !== before.dueAt?.getTime()) await requests.setDue(db, actor, requestId, out.dueAt);
  if (out.question) await aiContext.addQuestion(db, actor, { text: out.question, requestId });
  await requests.setAiState(db, actor, requestId, { aiStatus: "done", ...(out.question ? { aiQuestion: out.question } : {}) });

  if (titled && before.botConfirmChatId && before.botConfirmMessageId) {
    const msg = confirmationMessage({ id: requestId, title: out.title }, assignee);
    const tg = deps.tg ?? (await import("@/lib/telegram")).tg;
    await tg("editMessageText", {
      chat_id: before.botConfirmChatId,
      message_id: before.botConfirmMessageId,
      text: msg.html,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: msg.buttons.map((b) => [b]) },
    });
  }
}
