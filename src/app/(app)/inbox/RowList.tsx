"use client";

import { type ReactNode, startTransition, useOptimistic } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Group } from "@/components/request/Group";
import { RequestRow } from "@/components/request/RequestRow";
import { CLOSED } from "@/lib/constants";
import type { Status } from "@/lib/types";
import { groupInbox, groupRaised } from "@/services/grouping";
import type { ListItem } from "@/services/requests";
import { setRowStatus } from "./actions";

type Change = { item: ListItem; status: Status; customStatus: string | null };

const byNewest = (a: ListItem, b: ListItem) => +new Date(b.createdAt) - +new Date(a.createdAt) || b.id - a.id;

/**
 * The rows, with a "Mark done" checkbox on requests assigned to me. Optimistic: the row updates (and, when grouped,
 * moves bucket) at once; the server action refreshes the page; a toast offers Undo, which puts the old status back.
 * `view` groups the rows with groupInbox / groupRaised (on the optimistic rows); without it, a plain list.
 */
export function RowList({
  items,
  meId,
  filter = "all",
  view,
  now: nowIso,
  empty,
  expand,
}: {
  items: ListItem[];
  meId: number;
  /** plain list only: drop rows that no longer fit after a change */
  filter?: "open" | "done" | "all";
  view?: "inbox" | "raised";
  /** the server's clock (ISO), so server and client group the same way */
  now?: string;
  /** grouped: shown when nothing is left outside the collapsed Done group ("You're all caught up") */
  empty?: ReactNode;
  /** grouped: open every group (a tile filter is on) */
  expand?: boolean;
}) {
  const now = nowIso ? new Date(nowIso) : new Date();
  const [rows, apply] = useOptimistic(items, (rows: ListItem[], c: Change) => {
    const next = { ...c.item, status: c.status, customStatus: c.customStatus, doneAt: CLOSED.includes(c.status) ? new Date() : null };
    const others = rows.filter((r) => r.id !== c.item.id);
    const fits = view || filter === "all" || (filter === "done") === CLOSED.includes(c.status);
    return fits ? [...others, next].sort(byNewest) : others;
  });

  function change(item: ListItem, status: Status, customStatus: string | null, undo?: Pick<ListItem, "status" | "customStatus">) {
    startTransition(async () => {
      apply({ item, status, customStatus });
      const res = await setRowStatus(item.id, status, customStatus);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (undo)
        toast(status === "done" ? `#${item.id} marked done` : `#${item.id} reopened`, {
          duration: 6000,
          action: { label: "Undo", onClick: () => change({ ...item, status, customStatus }, undo.status, undo.customStatus) },
        });
    });
  }

  const anyCheck = rows.some((r) => r.assigneeId === meId);
  const row = (item: ListItem, bucket?: string) => {
    const closed = CLOSED.includes(item.status);
    return (
      <RequestRow
        key={item.id}
        item={item}
        meId={meId}
        now={now}
        bucket={bucket}
        check={
          item.assigneeId !== meId ? (
            anyCheck && <span aria-hidden className="block size-5" /> // keeps titles aligned in mixed lists
          ) : (
            <Checkbox
              checked={closed}
              onCheckedChange={(on) => change(item, on ? "done" : "open", null, item)}
              aria-label={closed ? `Reopen #${item.id}` : `Mark #${item.id} done`}
              className="size-5 rounded-md"
            />
          )
        }
      />
    );
  };

  if (!view)
    return (
      <ul className="divide-y divide-line-soft overflow-hidden rounded-[var(--radius-card)] border border-line-soft bg-paper">
        {rows.map((r) => row(r))}
      </ul>
    );

  const { groups } = view === "inbox" ? groupInbox(rows, now) : groupRaised(rows, now);
  return (
    <div className="flex flex-col gap-6">
      {groups.every((g) => g.collapsedByDefault && !expand) && empty}
      {groups.map((g) => (
        <Group key={g.key} title={g.title} count={g.count} collapsedByDefault={g.collapsedByDefault && !expand} rows={g.items.map((i) => row(i, g.key))} />
      ))}
    </div>
  );
}
