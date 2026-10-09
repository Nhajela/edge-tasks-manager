"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm } from "./ActionForm";
import { removeAction, updateFactAction } from "./actions";

/** One fact: reads as text; Edit opens save / cancel / delete (delete lives behind Edit so it isn't one stray tap). */
export function FactRow({ id, text }: { id: number; text: string }) {
  const [editing, setEditing] = useState(false);
  if (!editing)
    return (
      <li className="flex items-start justify-between gap-3 py-3">
        <p className="min-w-0 whitespace-pre-wrap break-words text-[15px] leading-6">{text}</p>
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)} aria-label={`Edit fact: ${text.slice(0, 40)}`}>
          Edit
        </Button>
      </li>
    );
  return (
    <li className="flex flex-col gap-2 py-3">
      <ActionForm action={updateFactAction} onDone={() => setEditing(false)} className="flex flex-col gap-2">
        <input type="hidden" name="id" value={id} />
        <Textarea name="text" defaultValue={text} required maxLength={4000} aria-label="Fact" autoFocus />
        <div className="flex gap-2">
          <Button type="submit" size="sm">Save</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </ActionForm>
      <ActionForm action={removeAction} className="self-end">
        <input type="hidden" name="id" value={id} />
        <Button type="submit" variant="ghost" size="sm" className="text-danger">
          Delete fact
        </Button>
      </ActionForm>
    </li>
  );
}
