import type { Via } from "@/lib/types";
export type { DbClient } from "@/db";

/**
 * Who is acting. Adapters resolve it (src/lib/actor.ts) before calling any service.
 * - person: a human via telegram/web; mcp: a person's API token; ai: the titler; system: cron/bootstrap.
 */
export type Actor = {
  kind: "person" | "system" | "ai" | "mcp";
  /** people.id; null for system/ai */
  personId: number | null;
  /** snapshotted into audit_log.actor_label */
  displayName: string;
  isAdmin: boolean;
  via: Via;
};

/** Side effects a service wants run after the response (adapters run them with after() + runEffects). */
export type Effect =
  | { kind: "notify"; message: OutgoingMessage }
  | { kind: "title"; requestId: number };

/** A Telegram message to send. Built by services/notifications, sent by a Notifier. */
export type OutgoingMessage = {
  chatId: number;
  /** HTML (Telegram parse_mode HTML), already escaped */
  html: string;
  /** bot_messages.kind */
  kind: "created" | "assigned" | "status" | "comment" | "group_fallback" | "bot_reply" | "prompt" | "login" | "admin_ping";
  replyTo?: number | null;
  requestId?: number | null;
  /** people.id of a DM recipient, so a 403 can flip started_bot off */
  recipientPersonId?: number | null;
  /** Send as a photo with `html` as its caption (sendPhoto): a Telegram file_id, or a public URL. */
  photo?: { fileId: string } | { url: string } | null;
  /** url buttons, or callback buttons (`st:<id>:<status>`, handled in src/lib/bot/callbacks.ts) */
  buttons?: ({ text: string; url: string } | { text: string; callback_data: string })[];
};
