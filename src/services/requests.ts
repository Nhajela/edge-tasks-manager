import { and, asc, desc, eq, gt, inArray, notInArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { attachments, botMessages, people, requestMessages, requests } from "@/db/schema";
import { CLOSED, PRIORITIES, STATUSES, STATUS_LABEL } from "@/lib/constants";
import { heuristicTitle } from "@/lib/title";
import type { AiStatus, Attachment, AuditEntry, Person, Priority, Request, RequestMessage, Status } from "@/lib/types";
import * as audit from "./audit";
import { NotFoundError, PermissionError, TEXT_LIMITS, ValidationError, requireText } from "./errors";
import * as notifications from "./notifications";
import * as peopleSvc from "./people";
import { requireAdmin, requireManage, requirePerson, requireView, isParticipant } from "./permissions";
import type { Actor, DbClient, Effect } from "./types";

// ─── inputs / outputs ────────────────────────────────────

export type MessageInput = {
  messageId: number;
  replyToMessageId?: number | null;
  fromId?: number | null;
  text?: string;
  link?: string | null;
};

export type AttachmentInput = {
  messageId?: number | null;
  telegramFileId: string;
  telegramFileUniqueId: string;
  kind: "photo" | "document";
  mime?: string | null;
  fileName?: string | null;
  width?: number | null;
  height?: number | null;
  size?: number | null;
};

export type CreateInput = {
  requesterId: number;
  assigneeId: number;
  body: string;
  /** a human-given title locks it against the AI */
  title?: string | null;
  priority?: Priority;
  dueAt?: Date | null;
  chatId?: number | null;
  chatTitle?: string | null;
  sourceMessageId?: number | null;
  messageLink?: string | null;
  /** Telegram messages behind it (source and command), stored as kind "original"; also the retry dedupe key */
  messages?: MessageInput[];
  attachments?: AttachmentInput[];
};

export type MessageAddInput = {
  requestId: number;
  chatId?: number | null;
  messageId?: number | null;
  /** the Telegram message this one replied to (thread quotes) */
  replyToMessageId?: number | null;
  fromId?: number | null;
  text: string;
  link?: string | null;
  attachments?: AttachmentInput[];
};

export type Result = { request: Request; effects: Effect[] };
export type AddResult = Result & { duplicate: boolean };
export type FieldResult = { request: Request; changed: boolean };

export type StatusFilter = "open" | "done" | "all" | Status;
export type ListFilter = { status?: StatusFilter; personId?: number; limit?: number; offset?: number };
export type ListItem = Request & { requester: Person; assignee: Person; attachmentCount: number; threadCount: number };
export type ListResult = { items: ListItem[]; counts: { open: number; done: number; all: number } };

export type DetailMessage = RequestMessage & { from: Person | null };
export type Detail = {
  request: Request;
  requester: Person;
  assignee: Person;
  createdBy: Person;
  messages: DetailMessage[];
  attachments: Attachment[];
  /** audit_log rows for this request, oldest first */
  timeline: AuditEntry[];
};

// ─── helpers ─────────────────────────────────────────────

const clip = (s: string, n = 300) => (s.length > n ? s.slice(0, n) + "…" : s);

async function load(db: DbClient, id: number): Promise<Request> {
  const [r] = await db.select().from(requests).where(eq(requests.id, id));
  if (!r) throw new NotFoundError(`Request #${id} not found.`, { id });
  return r;
}

async function parties(db: DbClient, r: Request) {
  const ps = await peopleSvc.getMany(db, [r.requesterId, r.assigneeId]);
  return { requester: ps.find((p) => p.id === r.requesterId) ?? null, assignee: ps.find((p) => p.id === r.assigneeId) ?? null };
}

async function notifyEffects(db: DbClient, actor: Actor, r: Request, event: notifications.NotifyEvent): Promise<Effect[]> {
  return notifications.decide(actor, r, await parties(db, r), event).map((message) => ({ kind: "notify" as const, message }));
}

async function insertAttachments(db: DbClient, requestId: number, chatId: number | null | undefined, list: AttachmentInput[] = []) {
  if (!list.length) return;
  await db
    .insert(attachments)
    .values(list.map((a) => ({ ...a, requestId, chatId: chatId ?? null })))
    .onConflictDoNothing();
}

/** Telegram adapters may attach messages from anyone in the request's chat; elsewhere you must be on the request. */
function requireMessageAccess(actor: Actor, r: Request, chatId: number | null | undefined) {
  if (actor.via === "telegram" && chatId != null && chatId === r.chatId) return;
  if (actor.via === "telegram" && actor.personId != null && isParticipant(actor, r)) return;
  requireManage(actor, r);
}

// ─── create / append / thread ────────────────────────────

export async function create(db: DbClient, actor: Actor, input: CreateInput): Promise<AddResult> {
  const body = requireText(input.body, "Request text", TEXT_LIMITS.body);
  // telegram adapters decide who the requester is (reply case); on the web/MCP you can only ask for yourself
  if (actor.kind !== "system" && actor.via !== "telegram" && !actor.isAdmin && requirePerson(actor) !== input.requesterId)
    throw new PermissionError("You can only raise requests as yourself.");
  if (input.priority && !PRIORITIES.includes(input.priority)) throw new ValidationError("Unknown priority.");

  const messages = input.messages ?? [];
  if (input.chatId != null && messages.length) {
    const [dupe] = await db
      .select({ requestId: requestMessages.requestId })
      .from(requestMessages)
      .where(and(eq(requestMessages.chatId, input.chatId), inArray(requestMessages.messageId, messages.map((m) => m.messageId))))
      .limit(1);
    if (dupe) return { request: await load(db, dupe.requestId), effects: [], duplicate: true };
  }
  const ps = await peopleSvc.getMany(db, [input.requesterId, input.assigneeId]);
  if (!ps.some((p) => p.id === input.requesterId) || !ps.some((p) => p.id === input.assigneeId))
    throw new NotFoundError("Requester or assignee not found.");

  const title = input.title?.trim() ? requireText(input.title, "Title", TEXT_LIMITS.title) : null;
  const [request] = await db
    .insert(requests)
    .values({
      title: title ?? heuristicTitle(body),
      titleLocked: Boolean(title),
      body,
      priority: input.priority ?? "normal",
      priorityLocked: Boolean(input.priority),
      dueAt: input.dueAt ?? null,
      dueLocked: input.dueAt != null,
      requesterId: input.requesterId,
      assigneeId: input.assigneeId,
      createdById: actor.personId ?? input.requesterId,
      chatId: input.chatId ?? null,
      chatTitle: input.chatTitle ?? null,
      sourceMessageId: input.sourceMessageId ?? messages[0]?.messageId ?? null,
      messageLink: input.messageLink ?? messages[0]?.link ?? null,
    })
    .returning();
  if (input.chatId != null && messages.length)
    await db
      .insert(requestMessages)
      .values(
        messages.map((m) => ({
          requestId: request.id,
          chatId: input.chatId!,
          messageId: m.messageId,
          replyToMessageId: m.replyToMessageId ?? null,
          fromId: m.fromId ?? null,
          text: m.text ?? "",
          link: m.link ?? null,
          kind: "original" as const,
        })),
      )
      .onConflictDoNothing();
  await insertAttachments(db, request.id, input.chatId, input.attachments);
  await audit.record(db, actor, {
    action: "request.create",
    entityType: "request",
    entityId: request.id,
    summary: request.title,
    data: { requesterId: request.requesterId, assigneeId: request.assigneeId, chatId: request.chatId },
  });
  const effects: Effect[] = [{ kind: "title", requestId: request.id }, ...(await notifyEffects(db, actor, request, { kind: "assigned" }))];
  return { request, effects, duplicate: false };
}

async function addMessage(db: DbClient, actor: Actor, input: MessageAddInput, kind: "append" | "thread"): Promise<AddResult> {
  const text = kind === "append" ? requireText(input.text, "Text", TEXT_LIMITS.body) : (input.text ?? "").slice(0, TEXT_LIMITS.body);
  let request = await load(db, input.requestId);
  requireMessageAccess(actor, request, input.chatId);
  if (input.chatId != null && input.messageId != null) {
    const inserted = await db
      .insert(requestMessages)
      .values({
        requestId: request.id,
        chatId: input.chatId,
        messageId: input.messageId,
        replyToMessageId: input.replyToMessageId ?? null,
        fromId: input.fromId ?? null,
        text,
        link: input.link ?? null,
        kind,
      })
      .onConflictDoNothing()
      .returning({ id: requestMessages.id });
    if (!inserted.length) return { request, effects: [], duplicate: true };
  }
  if (kind === "append")
    [request] = await db
      .update(requests)
      .set({
        body: sql`CASE WHEN ${requests.body} = '' THEN ${text} ELSE ${requests.body} || E'\n\n' || ${text} END`,
        updatedAt: new Date(),
      })
      .where(eq(requests.id, request.id))
      .returning();
  else [request] = await db.update(requests).set({ updatedAt: new Date() }).where(eq(requests.id, request.id)).returning();
  await insertAttachments(db, request.id, input.chatId, input.attachments);
  await audit.record(db, actor, {
    action: `request.${kind}`,
    entityType: "request",
    entityId: request.id,
    summary: clip(text),
    data: { chatId: input.chatId ?? null, messageId: input.messageId ?? null, fromId: input.fromId ?? null },
  });
  return { request, effects: kind === "append" ? [{ kind: "title", requestId: request.id }] : [], duplicate: false };
}

/** /append: add a message to the request body (re-titles). Dedupes Telegram retries by (chat, message). */
export const append = (db: DbClient, actor: Actor, input: MessageAddInput) => addMessage(db, actor, input, "append");

/** A reply to any message tied to a request: shown in the thread, does not change the body or ping anyone. */
export const addThreadMessage = (db: DbClient, actor: Actor, input: MessageAddInput) => addMessage(db, actor, input, "thread");

/** /append target: the author's most recent open request in this chat in the last 24h, else anywhere. */
export async function findAppendTarget(db: DbClient, opts: { authorPersonId: number; chatId?: number | null }): Promise<Request | null> {
  const open = and(eq(requests.requesterId, opts.authorPersonId), notInArray(requests.status, CLOSED));
  const latest = (where: SQL | undefined) =>
    db.select().from(requests).where(where).orderBy(desc(requests.createdAt), desc(requests.id)).limit(1);
  if (opts.chatId != null) {
    const [here] = await latest(and(open, eq(requests.chatId, opts.chatId), gt(requests.createdAt, new Date(Date.now() - 24 * 3600_000))));
    if (here) return here;
  }
  const [any] = await latest(open);
  return any ?? null;
}

/** Which request a Telegram message belongs to: source/command/appended/thread messages, or a bot message about it. */
export async function findRequestByTelegramMessage(db: DbClient, chatId: number, messageId: number): Promise<number | null> {
  const [row] = await db
    .select({ id: requestMessages.requestId })
    .from(requestMessages)
    .where(and(eq(requestMessages.chatId, chatId), eq(requestMessages.messageId, messageId)))
    .unionAll(
      db.select({ id: requests.id }).from(requests).where(and(eq(requests.chatId, chatId), eq(requests.sourceMessageId, messageId))),
    )
    .unionAll(
      db
        .select({ id: requests.id })
        .from(requests)
        .where(and(eq(requests.botConfirmChatId, chatId), eq(requests.botConfirmMessageId, messageId))),
    )
    .unionAll(
      db
        .select({ id: sql<number>`${botMessages.requestId}` })
        .from(botMessages)
        .where(and(eq(botMessages.chatId, chatId), eq(botMessages.telegramMessageId, messageId), sql`${botMessages.requestId} IS NOT NULL`)),
    )
    .limit(1);
  return row?.id ?? null;
}

/** The bot's "#12 created" reply: edited when the AI title lands; replies to it thread/append into the request. */
export async function setBotConfirmation(
  db: DbClient,
  actor: Actor,
  id: number,
  msg: { chatId: number; messageId: number },
): Promise<Request> {
  const [r] = await db
    .update(requests)
    .set({ botConfirmChatId: msg.chatId, botConfirmMessageId: msg.messageId })
    .where(eq(requests.id, id))
    .returning();
  if (!r) throw new NotFoundError(`Request #${id} not found.`);
  await audit.record(db, actor, { action: "request.bot_confirm", entityType: "request", entityId: id, data: msg });
  return r;
}

// ─── status / comment / fields ───────────────────────────

export async function setStatus(
  db: DbClient,
  actor: Actor,
  id: number,
  input: { status: Status; customStatus?: string | null; note?: string | null },
): Promise<Result> {
  if (!STATUSES.includes(input.status)) throw new ValidationError("Unknown status.", { status: input.status });
  const before = await load(db, id);
  requireManage(actor, before);
  const customStatus =
    input.customStatus === undefined
      ? input.status === before.status
        ? before.customStatus
        : null
      : input.customStatus?.trim()
        ? requireText(input.customStatus, "Custom label", TEXT_LIMITS.name)
        : null;
  const closed = CLOSED.includes(input.status);
  const note = input.note?.trim() ? requireText(input.note, "Note", TEXT_LIMITS.comment) : null;
  const [request] = await db
    .update(requests)
    .set({
      status: input.status,
      customStatus,
      doneAt: closed ? (before.doneAt ?? new Date()) : null,
      updatedAt: new Date(),
    })
    .where(eq(requests.id, id))
    .returning();
  await audit.record(db, actor, {
    action: "request.status",
    entityType: "request",
    entityId: id,
    summary: (customStatus ?? STATUS_LABEL[input.status]) + (note ? ` — ${clip(note)}` : ""),
    data: { from: before.status, to: input.status, customStatus, note },
  });
  return { request, effects: await notifyEffects(db, actor, request, { kind: "status", status: input.status, customStatus, note }) };
}

/** Comments are audit rows (action request.comment); the timeline reads them from there. */
export async function comment(db: DbClient, actor: Actor, id: number, input: { text: string; notify?: boolean }): Promise<Result> {
  const text = requireText(input.text, "Comment", TEXT_LIMITS.comment);
  const notify = input.notify ?? true;
  const before = await load(db, id);
  requireManage(actor, before);
  const [request] = await db.update(requests).set({ updatedAt: new Date() }).where(eq(requests.id, id)).returning();
  await audit.record(db, actor, { action: "request.comment", entityType: "request", entityId: id, summary: text, data: { notify } });
  return { request, effects: await notifyEffects(db, actor, request, { kind: "comment", text, notify }) };
}

type LockedField = "title" | "priority" | "dueAt";
const LOCK = { title: "titleLocked", priority: "priorityLocked", dueAt: "dueLocked" } as const;
const ACTION = { title: "request.title", priority: "request.priority", dueAt: "request.due" } as const;

/** Humans set and lock; the AI only writes fields no human has edited. */
async function setField<F extends LockedField>(db: DbClient, actor: Actor, id: number, field: F, value: Request[F], summary: string) {
  const before = await load(db, id);
  requireManage(actor, before);
  const isAi = actor.kind === "ai";
  if (isAi && before[LOCK[field]]) return { request: before, changed: false };
  const [request] = await db
    .update(requests)
    .set({ [field]: value, ...(isAi ? {} : { [LOCK[field]]: true }), updatedAt: new Date() })
    .where(eq(requests.id, id))
    .returning();
  await audit.record(db, actor, {
    action: ACTION[field],
    entityType: "request",
    entityId: id,
    summary,
    data: { from: before[field] instanceof Date ? before[field].toISOString() : before[field], to: value instanceof Date ? value.toISOString() : value },
  });
  return { request, changed: true };
}

export async function setTitle(db: DbClient, actor: Actor, id: number, title: string): Promise<FieldResult> {
  const t = requireText(title, "Title", TEXT_LIMITS.title);
  return setField(db, actor, id, "title", t, t);
}

export async function setPriority(db: DbClient, actor: Actor, id: number, priority: Priority): Promise<FieldResult> {
  if (!PRIORITIES.includes(priority)) throw new ValidationError("Unknown priority.", { priority });
  return setField(db, actor, id, "priority", priority, `Priority ${priority}`);
}

export async function setDue(db: DbClient, actor: Actor, id: number, dueAt: Date | null): Promise<FieldResult> {
  if (dueAt && Number.isNaN(dueAt.getTime())) throw new ValidationError("Invalid due date.");
  return setField(db, actor, id, "dueAt", dueAt, dueAt ? `Due ${dueAt.toISOString()}` : "No due date");
}

/** The titler's bookkeeping: ai_status and its open question. */
export async function setAiState(
  db: DbClient,
  actor: Actor,
  id: number,
  input: { aiStatus?: AiStatus; aiQuestion?: string | null },
): Promise<{ request: Request }> {
  const before = await load(db, id);
  requireManage(actor, before);
  const [request] = await db
    .update(requests)
    .set({
      ...(input.aiStatus ? { aiStatus: input.aiStatus } : {}),
      ...(input.aiQuestion !== undefined ? { aiQuestion: input.aiQuestion } : {}),
    })
    .where(eq(requests.id, id))
    .returning();
  await audit.record(db, actor, {
    action: "request.ai",
    entityType: "request",
    entityId: id,
    summary: input.aiQuestion ? `Asked: ${input.aiQuestion}` : `AI ${input.aiStatus ?? "updated"}`,
    data: input,
  });
  return { request };
}

// ─── reads ───────────────────────────────────────────────

const requesterP = alias(people, "requester");
const assigneeP = alias(people, "assignee");

function statusWhere(status: StatusFilter = "open"): SQL | undefined {
  if (status === "all") return undefined;
  if (status === "open") return notInArray(requests.status, CLOSED);
  if (status === "done") return inArray(requests.status, CLOSED);
  return eq(requests.status, status);
}

async function list(db: DbClient, scope: SQL | undefined, filter: ListFilter): Promise<ListResult> {
  const where = and(
    scope,
    filter.personId ? or(eq(requests.requesterId, filter.personId), eq(requests.assigneeId, filter.personId)) : undefined,
  );
  const [rows, [counts]] = await Promise.all([
    db
      .select({
        request: requests,
        requester: requesterP,
        assignee: assigneeP,
        attachmentCount: sql<number>`(SELECT count(*) FROM ${attachments} WHERE ${attachments.requestId} = ${requests.id})::int`,
        threadCount: sql<number>`(SELECT count(*) FROM ${requestMessages} WHERE ${requestMessages.requestId} = ${requests.id} AND ${requestMessages.kind} = 'thread')::int`,
      })
      .from(requests)
      .innerJoin(requesterP, eq(requesterP.id, requests.requesterId))
      .innerJoin(assigneeP, eq(assigneeP.id, requests.assigneeId))
      .where(and(where, statusWhere(filter.status)))
      .orderBy(desc(requests.createdAt), desc(requests.id))
      .limit(Math.min(filter.limit ?? 100, 500))
      .offset(filter.offset ?? 0),
    db
      .select({
        open: sql<number>`count(*) FILTER (WHERE ${requests.status} NOT IN ('done','declined'))::int`,
        done: sql<number>`count(*) FILTER (WHERE ${requests.status} IN ('done','declined'))::int`,
        all: sql<number>`count(*)::int`,
      })
      .from(requests)
      .where(where),
  ]);
  return {
    items: rows.map((r) => ({ ...r.request, requester: r.requester, assignee: r.assignee, attachmentCount: r.attachmentCount, threadCount: r.threadCount })),
    counts,
  };
}

/** To me. */
export async function listInbox(db: DbClient, actor: Actor, filter: ListFilter = {}): Promise<ListResult> {
  return list(db, eq(requests.assigneeId, requirePerson(actor)), filter);
}

/** I asked. */
export async function listRaised(db: DbClient, actor: Actor, filter: ListFilter = {}): Promise<ListResult> {
  return list(db, eq(requests.requesterId, requirePerson(actor)), filter);
}

/** Everything between me and another person, both ways. */
export async function listBetween(db: DbClient, actor: Actor, otherPersonId: number, filter: ListFilter = {}): Promise<ListResult> {
  const me = requirePerson(actor);
  return list(
    db,
    or(
      and(eq(requests.requesterId, me), eq(requests.assigneeId, otherPersonId)),
      and(eq(requests.requesterId, otherPersonId), eq(requests.assigneeId, me)),
    ),
    filter,
  );
}

/** Admin: all requests, optionally involving one person. */
export async function listAll(db: DbClient, actor: Actor, filter: ListFilter = {}): Promise<ListResult> {
  requireAdmin(actor);
  return list(db, undefined, filter);
}

export async function getDetail(db: DbClient, actor: Actor, id: number): Promise<Detail> {
  const request = await load(db, id);
  requireView(actor, request);
  const [ps, msgs, files, timeline] = await Promise.all([
    peopleSvc.getMany(db, [request.requesterId, request.assigneeId, request.createdById]),
    db.select().from(requestMessages).where(eq(requestMessages.requestId, id)).orderBy(asc(requestMessages.createdAt), asc(requestMessages.id)),
    db.select().from(attachments).where(eq(attachments.requestId, id)).orderBy(asc(attachments.id)),
    audit.listForEntity(db, "request", id),
  ]);
  const fromIds = msgs.map((m) => m.fromId).filter((x): x is number => x != null && !ps.some((p) => p.id === x));
  const all = [...ps, ...(await peopleSvc.getMany(db, fromIds))];
  const byId = (pid: number | null) => all.find((p) => p.id === pid) ?? null;
  return {
    request,
    requester: byId(request.requesterId)!,
    assignee: byId(request.assigneeId)!,
    createdBy: byId(request.createdById)!,
    messages: msgs.map((m) => ({ ...m, from: byId(m.fromId) })),
    attachments: files,
    timeline,
  };
}

/** Lightweight read for adapters that already checked access (e.g. the titler). */
export async function getById(db: DbClient, actor: Actor, id: number): Promise<Request> {
  const r = await load(db, id);
  requireView(actor, r);
  return r;
}
