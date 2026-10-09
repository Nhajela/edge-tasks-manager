import type { DbClient } from "@/db";
import type { Notifier } from "@/services/notifications";
import type { HandlerResult, Intent } from "./types";

export type HandlerDeps = {
  /** sends bot replies now (the returned messageId feeds requests.setBotConfirmation / prompts.create) */
  notifier: Notifier;
  now: () => Date;
};

/**
 * Execute an Intent: resolve the Actor (actorFromTelegram), call services, send the bot's replies through
 * deps.notifier, and return the services' effects for the route to run in after(). Never throws for user errors:
 * service errors become a short bot reply. Dedupe of Telegram retries comes from the services ((chat, message)).
 * STUB: the bot-handlers task fills this in.
 */
export async function handleIntent(db: DbClient, intent: Intent, deps: HandlerDeps): Promise<HandlerResult> {
  void db;
  void deps;
  if (intent.kind === "ignore") return { outcome: "ignored", effects: [] };
  throw new Error(`handleIntent(${intent.kind}): not implemented`);
}
