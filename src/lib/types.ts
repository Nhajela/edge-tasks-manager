import type { aiContext, apiTokens, attachments, auditLog, pendingPrompts, people, requestMessages, requests } from "@/db/schema";

export type Status = "open" | "in_progress" | "waiting" | "done" | "declined";
export type Priority = "low" | "normal" | "high" | "urgent";
export type Via = "telegram" | "web" | "mcp" | "ai" | "system";
export type ActorKind = "person" | "system" | "ai" | "mcp";
export type AiStatus = "pending" | "done" | "failed" | "skipped";
export type MessageKind = "original" | "append" | "thread" | "status";

export type Person = typeof people.$inferSelect;
export type Request = typeof requests.$inferSelect;
export type RequestMessage = typeof requestMessages.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
export type ApiToken = typeof apiTokens.$inferSelect;
export type AiContextItem = typeof aiContext.$inferSelect;
export type PendingPrompt = typeof pendingPrompts.$inferSelect;

export type Session = {
  telegramId: string;
  username: string | null;
  firstName: string;
};

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };
