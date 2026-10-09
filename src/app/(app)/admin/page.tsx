import Link from "next/link";
import { ImageIcon } from "lucide-react";
import { db } from "@/db";
import { Note } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { DueLabel } from "@/components/request/DueLabel";
import { PersonChip } from "@/components/request/PersonChip";
import { PriorityDot } from "@/components/request/PriorityDot";
import { StatusPill } from "@/components/request/StatusPill";
import { STATUSES, STATUS_LABEL } from "@/lib/constants";
import { relativeTime } from "@/lib/format";
import { displayName } from "@/lib/names";
import * as requests from "@/services/requests";
import { AdminHeader, Chip, Select, hrefWith, intParam, param, requireAdminViewer } from "./_ui";

const PAGE = 100;
const STATUS_FILTERS = ["open", "done", "all", ...STATUSES.filter((s) => s !== "open" && s !== "done")] as const;

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { actor } = await requireAdminViewer("/admin");
  const sp = await searchParams;
  const status = (STATUS_FILTERS as readonly string[]).includes(param(sp, "status")) ? (param(sp, "status") as requests.StatusFilter) : "open";
  const personId = intParam(param(sp, "person"));
  const chatId = intParam(param(sp, "chat"));
  const offset = Math.max(0, intParam(param(sp, "offset")) ?? 0);

  const [list, facets] = await Promise.all([
    requests.listAll(db(), actor, { status, personId, chatId, limit: PAGE, offset }),
    requests.adminFacets(db(), actor),
  ]);
  const keep = { person: personId, chat: chatId };
  const count = (s: string) => (s === "open" || s === "done" || s === "all" ? list.counts[s] : null);
  const filtered = personId != null || chatId != null;

  return (
    <section>
      <AdminHeader current="requests">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="status" value={status} />
          <Select label="Person" name="person" value={personId?.toString() ?? ""}>
            <option value="">Everyone</option>
            {facets.people.map((p) => (
              <option key={p.id} value={p.id}>
                {displayName(p)}
              </option>
            ))}
          </Select>
          <Select label="Chat" name="chat" value={chatId?.toString() ?? ""}>
            <option value="">All chats</option>
            {facets.chats.map((c) => (
              <option key={c.chatId} value={c.chatId}>
                {(c.chatTitle || `Chat ${c.chatId}`) + ` (${c.count})`}
              </option>
            ))}
          </Select>
          <div className="flex gap-2">
            <Button type="submit" size="lg">
              Filter
            </Button>
            {filtered && (
              <Button variant="ghost" size="lg" render={<Link href={hrefWith("/admin", { status })} />}>
                Clear
              </Button>
            )}
          </div>
        </form>
        <nav className="scroll-quiet -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1" aria-label="Status">
          {STATUS_FILTERS.map((s) => (
            <Chip key={s} href={hrefWith("/admin", { ...keep, status: s })} active={s === status}>
              {s === "all" ? "All" : s === "done" ? "Done & declined" : STATUS_LABEL[s]}
              {count(s) != null && <span className="tnum opacity-70">{count(s)}</span>}
            </Chip>
          ))}
        </nav>
      </AdminHeader>

      {list.items.length === 0 ? (
        <Note>No requests match these filters.</Note>
      ) : (
        <ul className="divide-y divide-line-soft overflow-hidden rounded-[var(--radius-card)] border border-line-soft bg-card">
          {list.items.map((r) => (
            <li key={r.id} className="relative flex flex-col gap-1.5 px-4 py-3 hover:bg-sand/50">
              <div className="flex items-start gap-2.5">
                <PriorityDot priority={r.priority} className="mt-[7px]" />
                <Link href={`/r/${r.id}`} className="min-w-0 flex-1 font-medium leading-6 after:absolute after:inset-0">
                  <span className="tnum mr-1.5 text-ink-mute">#{r.id}</span>
                  {r.title}
                </Link>
                <StatusPill status={r.status} customStatus={r.customStatus} className="max-w-[40%] shrink-0" />
              </div>
              {/* people links sit above the row-wide link */}
              <div className="relative z-10 flex flex-wrap items-center gap-x-2 gap-y-1 pl-5 text-[13.5px] text-ink-mute">
                <span className="flex min-w-0 items-center gap-1">
                  <PersonChip person={r.requester} className="font-normal text-ink-soft" />
                  <span aria-label="to">→</span>
                  <PersonChip person={r.assignee} className="font-normal text-ink-soft" />
                </span>
                {r.chatTitle && <span className="truncate">· {r.chatTitle}</span>}
                <span>· {relativeTime(r.createdAt)}</span>
                <DueLabel dueAt={r.dueAt} />
                {r.attachmentCount > 0 && (
                  <span className="inline-flex items-center gap-0.5" aria-label={`${r.attachmentCount} attachments`}>
                    <ImageIcon className="size-3.5" aria-hidden />
                    {r.attachmentCount}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {(offset > 0 || list.items.length === PAGE) && (
        <div className="mt-4 flex justify-between gap-2">
          {offset > 0 ? (
            <Button variant="outline" render={<Link href={hrefWith("/admin", { ...keep, status, offset: Math.max(0, offset - PAGE) || undefined })} />}>
              Newer
            </Button>
          ) : (
            <span />
          )}
          {list.items.length === PAGE && (
            <Button variant="outline" render={<Link href={hrefWith("/admin", { ...keep, status, offset: offset + PAGE })} />}>
              Older
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
