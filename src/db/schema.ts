import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { ActorKind, AiStatus, MessageKind, Priority, Status, Via } from "@/lib/types";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/**
 * Everyone we've seen on Telegram, plus @usernames we were told about before they talked to the bot
 * (telegram_id null until we see them). Usernames stored lowercase, no @.
 */
export const people = pgTable(
  "people",
  {
    id: serial().primaryKey(),
    telegramId: bigint("telegram_id", { mode: "number" }).unique(),
    username: text().unique(),
    firstName: text("first_name"),
    /** Has opened a DM with the bot, so we can message them. Flipped off on a 403. */
    startedBot: boolean("started_bot").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("people_username_lower", sql`${t.username} = lower(${t.username})`),
    check("people_known", sql`${t.telegramId} IS NOT NULL OR ${t.username} IS NOT NULL`),
  ],
);

export const requests = pgTable(
  "requests",
  {
    id: serial().primaryKey(),
    title: text().notNull(),
    /** Full text: the original message plus appended ones, joined by blank lines. */
    body: text().notNull().default(""),
    status: text().$type<Status>().notNull().default("open"),
    /** Free label shown instead of the status name ("ordering from Panjim"); the status stays underneath. */
    customStatus: text("custom_status"),
    priority: text().$type<Priority>().notNull().default("normal"),
    dueAt: ts("due_at"),
    requesterId: integer("requester_id").notNull().references(() => people.id),
    assigneeId: integer("assignee_id").notNull().references(() => people.id),
    /** Who ran the command; differs from the requester when someone /requests another person's message. */
    createdById: integer("created_by_id").notNull().references(() => people.id),
    /** null for requests made on the web or over MCP */
    chatId: bigint("chat_id", { mode: "number" }),
    chatTitle: text("chat_title"),
    sourceMessageId: bigint("source_message_id", { mode: "number" }),
    messageLink: text("message_link"),
    /** The bot's "#12 created" reply: edited when the AI title lands; replies to it append to the request. */
    botConfirmChatId: bigint("bot_confirm_chat_id", { mode: "number" }),
    botConfirmMessageId: bigint("bot_confirm_message_id", { mode: "number" }),
    /** Set when a human edits the field, so the AI titler leaves it alone. */
    titleLocked: boolean("title_locked").notNull().default(false),
    priorityLocked: boolean("priority_locked").notNull().default(false),
    dueLocked: boolean("due_locked").notNull().default(false),
    aiQuestion: text("ai_question"),
    aiStatus: text("ai_status").$type<AiStatus>().notNull().default("pending"),
    doneAt: ts("done_at"),
    /** First time the assignee opened it; null = "New" in their inbox. */
    assigneeSeenAt: ts("assignee_seen_at"),
    /** The deliverable shown on the "Delivered" card. Set on done / markDeliverable, cleared on reopen (history stays in audit_log). */
    resultNote: text("result_note"),
    /** → request_messages.id whose media is the deliverable */
    resultMessageId: integer("result_message_id").references((): AnyPgColumn => requestMessages.id, { onDelete: "set null" }),
    resultById: integer("result_by_id").references(() => people.id),
    resultAt: ts("result_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("requests_assignee_status").on(t.assigneeId, t.status),
    index("requests_requester_status").on(t.requesterId, t.status),
    index("requests_chat_requester").on(t.chatId, t.requesterId, t.createdAt),
    index("requests_bot_confirm").on(t.botConfirmChatId, t.botConfirmMessageId),
    index("requests_chat_source").on(t.chatId, t.sourceMessageId),
    index("requests_created").on(t.createdAt),
    check("requests_status_check", sql`${t.status} IN ('open','in_progress','waiting','done','declined')`),
    check("requests_priority_check", sql`${t.priority} IN ('low','normal','high','urgent')`),
    check("requests_ai_status_check", sql`${t.aiStatus} IN ('pending','done','failed','skipped')`),
  ],
);

/**
 * Each Telegram message attached to a request. kind 'status' = an in-thread status command (/done …): shown as a system
 * line, not counted as a thread reply, still a reply-chain target. Unique (chat, message) doubles as webhook-retry dedupe. */
export const requestMessages = pgTable(
  "request_messages",
  {
    id: serial().primaryKey(),
    requestId: integer("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    chatId: bigint("chat_id", { mode: "number" }).notNull(),
    messageId: bigint("message_id", { mode: "number" }).notNull(),
    /** the message this one replied to (same chat), so the UI can quote "↳ replying to <name>" */
    replyToMessageId: bigint("reply_to_message_id", { mode: "number" }),
    fromId: integer("from_id").references(() => people.id),
    text: text().notNull().default(""),
    link: text(),
    kind: text().$type<MessageKind>().notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("request_messages_chat_message").on(t.chatId, t.messageId),
    index("request_messages_request").on(t.requestId),
    check("request_messages_kind_check", sql`${t.kind} IN ('original','append','thread','status')`),
  ],
);

/**
 * THE audit log: one row per service mutation (request.create, request.status, token.create, auth.login, …).
 * The request timeline is a read view over this table filtered by entity.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: serial().primaryKey(),
    at: ts("at").notNull().defaultNow(),
    actorKind: text("actor_kind").$type<ActorKind>().notNull(),
    /** null for system / ai / mcp without a person */
    actorPersonId: integer("actor_person_id").references(() => people.id, { onDelete: "set null" }),
    /** snapshot of the actor's display name at write time */
    actorLabel: text("actor_label").notNull(),
    via: text().$type<Via>().notNull(),
    action: text().notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    summary: text().notNull().default(""),
    data: jsonb().$type<Record<string, unknown>>(),
  },
  (t) => [
    index("audit_log_entity").on(t.entityType, t.entityId, t.at),
    index("audit_log_at").on(t.at),
    check("audit_log_actor_kind_check", sql`${t.actorKind} IN ('person','system','ai','mcp')`),
    check("audit_log_via_check", sql`${t.via} IN ('telegram','web','mcp','ai','system')`),
  ],
);

/** Photos/documents from Telegram. Served via signed /api/files/<id>?sig= (Telegram getFile proxy, or R2 later). */
export const attachments = pgTable(
  "attachments",
  {
    id: serial().primaryKey(),
    requestId: integer("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    /** Telegram chat/message the file came from */
    chatId: bigint("chat_id", { mode: "number" }),
    messageId: bigint("message_id", { mode: "number" }),
    telegramFileId: text("telegram_file_id").notNull(),
    telegramFileUniqueId: text("telegram_file_unique_id").notNull(),
    kind: text().$type<"photo" | "document">().notNull(),
    mime: text(),
    fileName: text("file_name"),
    width: integer(),
    height: integer(),
    size: integer(),
    r2Key: text("r2_key"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("attachments_request_file").on(t.requestId, t.telegramFileUniqueId),
    check("attachments_kind_check", sql`${t.kind} IN ('photo','document')`),
  ],
);

/**
 * "What should @bob do?" prompts: a bare `@bot @bob` mention asks for details; the reply to the prompt becomes the
 * request body. Keyed by the bot's prompt message; usable once, for 1h.
 */
export const pendingPrompts = pgTable(
  "pending_prompts",
  {
    id: serial().primaryKey(),
    chatId: bigint("chat_id", { mode: "number" }).notNull(),
    promptMessageId: bigint("prompt_message_id", { mode: "number" }).notNull(),
    requesterId: integer("requester_id").notNull().references(() => people.id),
    assigneeId: integer("assignee_id").notNull().references(() => people.id),
    createdById: integer("created_by_id").references(() => people.id),
    /** the mention message that triggered the prompt */
    sourceMessageId: bigint("source_message_id", { mode: "number" }),
    chatTitle: text("chat_title"),
    expiresAt: ts("expires_at").notNull(),
    consumedAt: ts("consumed_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [unique("pending_prompts_chat_message").on(t.chatId, t.promptMessageId)],
);

export const loginCodes = pgTable(
  "login_codes",
  {
    code: text().primaryKey(),
    telegramId: bigint("telegram_id", { mode: "number" }),
    username: text(),
    firstName: text("first_name"),
    createdAt: ts("created_at").notNull().defaultNow(),
    claimedAt: ts("claimed_at"),
    /** Pre-claimed links in bot messages live longer than the 30-min default. */
    expiresAt: ts("expires_at"),
  },
  (t) => [index("login_codes_created").on(t.createdAt)],
);

/** Every bot message we tried to send, with Telegram's answer. Proof of what actually went out. */
export const botMessages = pgTable(
  "bot_messages",
  {
    id: serial().primaryKey(),
    createdAt: ts("created_at").notNull().defaultNow(),
    chatId: bigint("chat_id", { mode: "number" }).notNull(),
    kind: text().notNull(),
    /** the request this message is about, so replies to it thread into that request */
    requestId: integer("request_id").references(() => requests.id, { onDelete: "set null" }),
    ok: boolean().notNull(),
    /** Telegram's id for the delivered message (null on failure) */
    telegramMessageId: bigint("telegram_message_id", { mode: "number" }),
    error: text(),
    text: text().notNull(),
    /** free-form state for bot flows (e.g. a pending "What should @bob do?" prompt) */
    data: jsonb().$type<Record<string, unknown>>(),
  },
  (t) => [
    index("bot_messages_created").on(t.createdAt),
    index("bot_messages_chat_message").on(t.chatId, t.telegramMessageId),
  ],
);

/** MCP bearer tokens (etm_…). Only the sha256 is stored; the raw token is shown once. */
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: serial().primaryKey(),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    name: text().notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    /** first 8 chars, for display */
    prefix: text().notNull(),
    lastUsedAt: ts("last_used_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index("api_tokens_person").on(t.personId)],
);

/** The AI titler's memory: facts and answered questions go into its prompt. */
export const aiContext = pgTable(
  "ai_context",
  {
    id: serial().primaryKey(),
    kind: text().$type<"fact" | "question">().notNull(),
    text: text().notNull(),
    answer: text(),
    /** the request that prompted a question */
    requestId: integer("request_id").references(() => requests.id, { onDelete: "set null" }),
    status: text().$type<"open" | "answered" | "dismissed">().notNull().default("open"),
    createdById: integer("created_by_id").references(() => people.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("ai_context_status").on(t.kind, t.status),
    check("ai_context_kind_check", sql`${t.kind} IN ('fact','question')`),
    check("ai_context_status_check", sql`${t.status} IN ('open','answered','dismissed')`),
  ],
);

/**
 * Every group message the bot saw in the last 3 days (raw Telegram JSON), so a request made later from a message can
 * pull in the replies that came before it. Not domain state: no audit rows; services/chatBuffer purges old rows.
 */
export const chatBuffer = pgTable(
  "chat_buffer",
  {
    id: serial().primaryKey(),
    createdAt: ts("created_at").notNull().defaultNow(),
    chatId: bigint("chat_id", { mode: "number" }).notNull(),
    messageId: bigint("message_id", { mode: "number" }).notNull(),
    replyToMessageId: bigint("reply_to_message_id", { mode: "number" }),
    message: jsonb().$type<Record<string, unknown>>().notNull(),
  },
  (t) => [uniqueIndex("chat_buffer_chat_message").on(t.chatId, t.messageId), index("chat_buffer_created").on(t.createdAt)],
);
