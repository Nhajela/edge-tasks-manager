import type { Intent, TgUpdate } from "./types";

export type ParseCtx = {
  /** the bot's username, without @ (any case) */
  botUsername: string;
  /** SUPERADMIN_USERNAME, without @ */
  superadminUsername: string;
};

/**
 * Pure: turn a Telegram update into an Intent (SPEC "Telegram bot" parsing rules). No DB, no network.
 * Messages from bots -> ignore. The webhook route is: parseUpdate -> handleIntent -> after(runEffects(result.effects)).
 * STUB: the bot-parse task fills this in.
 */
export function parseUpdate(update: TgUpdate, ctx: ParseCtx): Intent {
  void update;
  void ctx;
  throw new Error("parseUpdate: not implemented");
}
