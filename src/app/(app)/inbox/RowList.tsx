"use client";

import { startTransition, useOptimistic } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { RequestRow } from "@/components/request/RequestRow";
import { CLOSED } from "@/lib/constants";
import type { Status } from "@/lib/types";
import type { ListItem } from "@/services/requests";
import { setRowStatus } from "./actions";

type Change = { item: ListItem; status: Status; customStatus: string | null };

const byNewest = (a: ListItem, b: ListItem) => +new Date(b.createdAt) - +new Date(a.createdAt) || b.id - a.id;

/**
 * The rows, with a "Mark done" checkbox on requests assigned to me. Optimistic: the row updates (or leaves the Open
 * list) at once; the server action refreshes the page; a toast offers Undo, which puts the old status back.
 */
export function RowList({ items, meId, filter }: { items: ListItem[]; meId: number; filter: "open" | "done" | "all" }) {
  const [rows, apply] = useOptimistic(items, (rows: ListItem[], c: Change) => {
    const next = { ...c.item, status: c.status, customStatus: c.customStatus };
    const others = rows.filter((r) => r.id !== c.item.id);
    const fits = filter === "all" || (filter === "done") === CLOSED.includes(c.status);
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
  return (
    <ul className="divide-y divide-line-soft overflow-hidden rounded-[var(--radius-card)] border border-line-soft bg-paper">
      {rows.map((item) => (
        <RequestRow
          key={item.id}
          item={item}
          meId={meId}
          check={
            item.assigneeId !== meId ? (
              anyCheck && <span aria-hidden className="block size-5" /> // keeps titles aligned in mixed lists (/with)
            ) : (
              <Checkbox
                checked={item.status === "done"}
                onCheckedChange={(on) => change(item, on ? "done" : "open", null, item)}
                aria-label={item.status === "done" ? `Reopen #${item.id}` : `Mark #${item.id} done`}
                className="size-5 rounded-md"
              />
            )
          }
        />
      ))}
    </ul>
  );
}
