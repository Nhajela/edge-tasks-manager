import Link from "next/link";
import { db } from "@/db";
import { Note, Tag } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { formatDateTimeIST } from "@/lib/format";
import type { AuditEntry } from "@/lib/types";
import * as audit from "@/services/audit";
import { AdminHeader, Select, hrefWith, intParam, param, requireAdminViewer } from "../_ui";

const PAGE = 50;

/** Where an audit row's entity lives in the app, if anywhere. */
function entityLink(e: AuditEntry): { href: string; label: string } | null {
  if (!e.entityId) return null;
  if (e.entityType === "request") return { href: `/r/${e.entityId}`, label: `#${e.entityId}` };
  if (e.entityType === "ai_context") return { href: "/context", label: "AI context" };
  return null;
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminViewer("/admin/activity");
  const sp = await searchParams;
  const action = param(sp, "action");
  const actor = intParam(param(sp, "actor"));
  const before = intParam(param(sp, "before"));

  const [rows, facets] = await Promise.all([
    audit.listRecent(db(), { limit: PAGE, beforeId: before, action: action || undefined, actorPersonId: actor }),
    audit.facets(db()),
  ]);
  const keep = { action, actor };

  return (
    <section>
      <AdminHeader current="activity">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <Select label="Action" name="action" value={action}>
            <option value="">All actions</option>
            {facets.actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
          <Select label="Who" name="actor" value={actor?.toString() ?? ""}>
            <option value="">Anyone</option>
            {facets.actors.map((a) => (
              <option key={a.personId} value={a.personId}>
                {a.label}
              </option>
            ))}
          </Select>
          <div className="flex gap-2">
            <Button type="submit" size="lg">
              Filter
            </Button>
            {(action || actor != null) && (
              <Button variant="ghost" size="lg" render={<Link href="/admin/activity" />}>
                Clear
              </Button>
            )}
          </div>
        </form>
      </AdminHeader>

      {rows.length === 0 ? (
        <Note>Nothing logged{action || actor != null ? " for these filters" : " yet"}.</Note>
      ) : (
        <ol className="divide-y divide-line-soft overflow-hidden rounded-[var(--radius-card)] border border-line-soft bg-card">
          {rows.map((e) => {
            const link = entityLink(e);
            return (
              <li key={e.id} className="flex flex-col gap-1 px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px]">
                  {e.actorPersonId != null ? (
                    <Link href={hrefWith("/admin/activity", { ...keep, actor: e.actorPersonId })} className="font-medium underline-offset-2 hover:underline">
                      {e.actorLabel}
                    </Link>
                  ) : (
                    <span className="font-medium">{e.actorLabel}</span>
                  )}
                  <Link href={hrefWith("/admin/activity", { ...keep, action: e.action })} title={`Only ${e.action}`}>
                    <Tag tone={e.action.startsWith("request.") ? "blue" : e.action.startsWith("auth.") ? "teal" : "neutral"}>{e.action}</Tag>
                  </Link>
                  {link && (
                    <Link href={link.href} className="font-medium text-blue-deep underline-offset-2 hover:underline">
                      {link.label}
                    </Link>
                  )}
                  <span className="ml-auto text-[12.5px] text-ink-mute">
                    {formatDateTimeIST(e.at)} · {e.via}
                  </span>
                </div>
                {e.summary && <p className="line-clamp-3 break-words text-[14px] leading-5 text-ink-soft">{e.summary}</p>}
              </li>
            );
          })}
        </ol>
      )}

      <div className="mt-4 flex justify-between gap-2">
        {before ? (
          <Button variant="outline" render={<Link href={hrefWith("/admin/activity", keep)} />}>
            Newest
          </Button>
        ) : (
          <span />
        )}
        {rows.length === PAGE && (
          <Button variant="outline" render={<Link href={hrefWith("/admin/activity", { ...keep, before: rows[rows.length - 1].id })} />}>
            Older
          </Button>
        )}
      </div>
    </section>
  );
}
