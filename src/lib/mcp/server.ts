import { McpServer } from "@modelcontextprotocol/server";
import { after } from "next/server";
import { z } from "zod";
import { db as defaultDb } from "@/db";
import { PRIORITIES, STATUSES } from "@/lib/constants";
import { runEffects } from "@/lib/effects";
import { fileUrl } from "@/lib/files";
import { normalizeUsername } from "@/lib/admin";
import { displayName } from "@/lib/names";
import type { Person, Request } from "@/lib/types";
import { ServiceError, ValidationError, NotFoundError } from "@/services/errors";
import { requestUrl } from "@/services/notifications";
import * as people from "@/services/people";
import * as requests from "@/services/requests";
import type { Actor, DbClient, Effect } from "@/services/types";

export const INSTRUCTIONS = `Edge Tasks Manager: the task sheet for Edge City India (Mandrem, Goa, 11 Oct - 1 Nov 2026).
People raise "requests" (tasks, shown as #12) for each other, mostly from Telegram groups. You act as the person who owns this API token: you see requests they asked for (raised), requests asked of them (inbox), and, if they are an admin, everything.
- Start with whoami, then list_requests (inbox by default, open ones by default). Use get_request for the full story: body, the Telegram messages and reply thread with links, photos, and the timeline of every change.
- Attachment URLs are public signed links: fetch them directly, no auth needed.
- Statuses: open, in_progress, waiting (blocked on someone), done, declined. custom_label is a free-text label shown instead of the status name (e.g. "ordering from Panjim").
- Changes notify the other person on Telegram (status changes, comments with notify=true, new requests to the assignee). Confirm with the user before changing or creating anything on their behalf.
- Times are India time (IST, Asia/Kolkata). Every change is recorded in the audit log as made via MCP by this person.`;

const RO = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

const id = z.number().int().positive().describe("Request number, e.g. 12 for #12.");
const ref = (p: Person | null) => (p ? displayName(p) : null);
const person = (p: Person) => ({ id: p.id, username: p.username, name: p.firstName, display: displayName(p) });

type Out = { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
const ok = (data: Record<string, unknown>): Out => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data });
const fail = (text: string): Out => ({ content: [{ type: "text", text }], isError: true });

/** "2026-10-15" means by the end of that India day; anything else must be a full ISO timestamp. */
function parseDue(due: string | null): Date | null {
  if (due == null) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(due) ? `${due}T23:59:00+05:30` : due);
  if (Number.isNaN(d.getTime())) throw new ValidationError(`"${due}" is not a date. Use YYYY-MM-DD or an ISO timestamp.`);
  return d;
}

const summary = (r: Request & Partial<Pick<requests.ListItem, "requester" | "assignee" | "attachmentCount">>) => ({
  id: r.id,
  url: requestUrl(r.id),
  title: r.title,
  status: r.status,
  customStatus: r.customStatus,
  priority: r.priority,
  dueAt: r.dueAt?.toISOString() ?? null,
  doneAt: r.doneAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  ...(r.requester ? { requester: ref(r.requester), assignee: ref(r.assignee ?? null), attachmentCount: r.attachmentCount } : {}),
});

export type McpDeps = {
  db?: DbClient;
  /** Runs service effects (notifications, AI titling) after the response; tests capture them instead. */
  schedule?: (effects: Effect[]) => void;
};

/**
 * A fresh, stateless MCP server acting as `actor` (the person behind the Bearer etm_ token; actorFromToken).
 * Every tool is a thin call into src/services; /api/mcp builds one per request.
 */
export function createMcpServer(actor: Actor, deps: McpDeps = {}): McpServer {
  const db = deps.db ?? defaultDb();
  const schedule = deps.schedule ?? ((effects: Effect[]) => void (effects.length && after(() => runEffects(effects))));
  const server = new McpServer({ name: "edge-tasks", title: "Edge Tasks Manager", version: "1.0.0" }, { instructions: INSTRUCTIONS });

  // Service errors become messages a model can act on; anything else is logged and hidden.
  const tool = <A,>(name: string, fn: (a: A) => Promise<Record<string, unknown>>) => async (a: A): Promise<Out> => {
    try {
      return ok(await fn(a));
    } catch (e) {
      if (e instanceof ServiceError) return fail(`${e.code}: ${e.message}`);
      console.error(JSON.stringify({ scope: "mcp", tool: name, error: e instanceof Error ? e.stack : String(e) }));
      return fail("INTERNAL_ERROR: Something went wrong on our side. Try again.");
    }
  };

  const updated = (r: { request: Request; effects?: Effect[] }) => {
    if (r.effects) schedule(r.effects);
    return summary(r.request);
  };

  server.registerTool(
    "whoami",
    {
      title: "Who am I",
      description: "The person this token acts as (id, @username, admin or not) and how many open requests are in their inbox and raised lists.",
      inputSchema: z.object({}),
      annotations: RO,
    },
    tool("whoami", async () => {
      const me = actor.personId != null ? await people.getById(db, actor.personId) : null;
      if (!me) throw new NotFoundError("This token's person no longer exists.");
      const [inbox, raised] = await Promise.all([requests.listInbox(db, actor, { limit: 1 }), requests.listRaised(db, actor, { limit: 1 })]);
      return { ...person(me), isAdmin: actor.isAdmin, open: { inbox: inbox.counts.open, raised: raised.counts.open } };
    }),
  );

  server.registerTool(
    "list_requests",
    {
      title: "List requests",
      description:
        "List requests, newest first, with status, priority, due date, requester and assignee. box: inbox (asked of me, default), raised (I asked), all (admins only). Returns counts of open/done/all for the box.",
      inputSchema: z.object({
        box: z.enum(["inbox", "raised", "all"]).optional().describe("inbox (default), raised, or all (admins only)."),
        status: z
          .enum(["open", "done", "all", ...STATUSES])
          .optional()
          .describe("open (default: anything not done/declined), done (done or declined), all, or one exact status."),
        person: z.string().optional().describe("Only requests involving this @username (as requester or assignee)."),
        limit: z.number().int().min(1).max(100).optional().describe("Default 25."),
        offset: z.number().int().min(0).optional(),
      }),
      annotations: RO,
    },
    tool("list_requests", async (a) => {
      let personId: number | undefined;
      if (a.person) {
        const p = await people.findByUsername(db, normalizeUsername(a.person));
        if (!p) throw new NotFoundError(`No one called @${normalizeUsername(a.person)} yet.`);
        personId = p.id;
      }
      const filter = { status: a.status ?? "open", personId, limit: a.limit ?? 25, offset: a.offset ?? 0 };
      const box = a.box ?? "inbox";
      const res =
        box === "raised"
          ? await requests.listRaised(db, actor, filter)
          : box === "all"
            ? await requests.listAll(db, actor, filter)
            : await requests.listInbox(db, actor, filter);
      return { box, counts: res.counts, items: res.items.map(summary) };
    }),
  );

  server.registerTool(
    "get_request",
    {
      title: "Get request",
      description:
        "One request in full: body, every Telegram message behind it (original, appended, and the reply thread, with t.me links), attachments, the timeline of every change and comment, the AI's open question, and the people involved. Attachment urls are public URLs you can fetch directly (images, documents), no auth needed.",
      inputSchema: z.object({ id }),
      annotations: RO,
    },
    tool("get_request", async (a) => {
      const d = await requests.getDetail(db, actor, a.id);
      return {
        ...summary(d.request),
        body: d.request.body,
        aiQuestion: d.request.aiQuestion,
        chatTitle: d.request.chatTitle,
        messageLink: d.request.messageLink,
        people: { requester: person(d.requester), assignee: person(d.assignee), createdBy: person(d.createdBy) },
        messages: d.messages.map((m) => ({
          kind: m.kind,
          from: ref(m.from),
          text: m.text,
          link: m.link,
          messageId: m.messageId,
          replyToMessageId: m.replyToMessageId,
          at: m.createdAt.toISOString(),
        })),
        attachments: d.attachments.map((f) => ({
          id: f.id,
          kind: f.kind,
          mime: f.mime,
          fileName: f.fileName,
          width: f.width,
          height: f.height,
          url: fileUrl(f.id),
        })),
        timeline: d.timeline.map((t) => ({ at: t.at.toISOString(), by: t.actorLabel, via: t.via, action: t.action, summary: t.summary })),
      };
    }),
  );

  server.registerTool(
    "create_request",
    {
      title: "Create request",
      description:
        "Raise a new request as this person, asking @assignee to do something. The assignee is told on Telegram if they have started the bot. A title is generated from the text unless you give one.",
      inputSchema: z.object({
        assignee: z.string().min(1).describe("Telegram @username of the person being asked."),
        text: z.string().min(1).describe("What is being asked, in full."),
        title: z.string().optional().describe("Short title (otherwise the AI writes one)."),
        priority: z.enum(PRIORITIES as [string, ...string[]]).optional(),
        due: z.string().optional().describe("YYYY-MM-DD (end of that India day) or an ISO timestamp."),
      }),
      annotations: WRITE,
    },
    tool("create_request", async (a) => {
      const username = normalizeUsername(a.assignee);
      if (!/^[a-z0-9_]{3,32}$/.test(username)) throw new ValidationError(`"${a.assignee}" is not a Telegram username.`);
      const assignee = (await people.findByUsername(db, username)) ?? (await people.upsertFromTelegram(db, actor, { username }));
      const res = await requests.create(db, actor, {
        requesterId: actor.personId ?? -1,
        assigneeId: assignee.id,
        body: a.text,
        title: a.title,
        priority: a.priority as requests.CreateInput["priority"],
        dueAt: a.due ? parseDue(a.due) : null,
      });
      return { ...updated(res), assignee: displayName(assignee) };
    }),
  );

  server.registerTool(
    "update_status",
    {
      title: "Update status",
      description:
        "Set a request's status: open, in_progress, waiting (blocked on someone), done, declined. Optional custom_label shows instead of the status name; optional note explains the change. Done/declined notify the requester on Telegram.",
      inputSchema: z.object({
        id,
        status: z.enum(STATUSES as [string, ...string[]]),
        custom_label: z.string().nullable().optional().describe("Free label, e.g. 'ordering from Panjim'. null or empty clears it."),
        note: z.string().optional().describe("Why, shown in the timeline and the notification."),
      }),
      annotations: WRITE,
    },
    tool("update_status", async (a) =>
      updated(
        await requests.setStatus(db, actor, a.id, {
          status: a.status as (typeof STATUSES)[number],
          customStatus: a.custom_label,
          note: a.note,
        }),
      ),
    ),
  );

  server.registerTool(
    "add_comment",
    {
      title: "Add comment",
      description: "Comment on a request. notify (default true) also tells the other person on Telegram; set false for a quiet note on the timeline.",
      inputSchema: z.object({ id, text: z.string().min(1), notify: z.boolean().optional().describe("Default true.") }),
      annotations: WRITE,
    },
    tool("add_comment", async (a) => updated(await requests.comment(db, actor, a.id, { text: a.text, notify: a.notify ?? true }))),
  );

  server.registerTool(
    "set_due",
    {
      title: "Set due date",
      description: "Set or clear a request's due date. YYYY-MM-DD means by the end of that India day; or give an ISO timestamp; null clears it.",
      inputSchema: z.object({ id, due: z.string().nullable() }),
      annotations: WRITE,
    },
    tool("set_due", async (a) => updated(await requests.setDue(db, actor, a.id, parseDue(a.due)))),
  );

  server.registerTool(
    "set_priority",
    {
      title: "Set priority",
      description: "Set a request's priority: low, normal, high or urgent. Once set by a person, the AI titler won't change it.",
      inputSchema: z.object({ id, priority: z.enum(PRIORITIES as [string, ...string[]]) }),
      annotations: WRITE,
    },
    tool("set_priority", async (a) => updated(await requests.setPriority(db, actor, a.id, a.priority as (typeof PRIORITIES)[number]))),
  );

  return server;
}
