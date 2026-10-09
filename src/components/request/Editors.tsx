"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Lock, Pencil } from "lucide-react";
import { toast } from "sonner";
import { SubmitButton } from "@/components/feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PRIORITIES } from "@/lib/constants";
import type { ActionResult, Priority } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PriorityDot } from "./PriorityDot";

type Save<T> = (value: T) => Promise<ActionResult>;

/** The request title as the page heading; tapping the pencil edits it (a human edit locks it against the AI). */
export function TitleEditor({ title, locked, onSave }: { title: string; locked: boolean; onSave: Save<string> }) {
  const [editing, setEditing] = useState(false);
  if (!editing)
    return (
      <div className="flex items-start gap-1.5">
        <h1 className="min-w-0 flex-1 break-words text-[24px] font-bold leading-tight tracking-tight sm:text-[28px]">{title}</h1>
        <Button variant="ghost" size="icon-sm" aria-label="Edit title" onClick={() => setEditing(true)} className="mt-0.5">
          <Pencil />
        </Button>
      </div>
    );
  return (
    <form
      action={async (fd) => {
        const r = await onSave(String(fd.get("title") ?? ""));
        if (r.ok) setEditing(false);
        else toast.error(r.error);
      }}
      className="flex flex-col gap-2"
    >
      <label htmlFor="title" className="text-[13px] font-medium text-ink-soft">
        Title
      </label>
      <Input id="title" name="title" defaultValue={title} maxLength={200} required autoFocus className="h-11 text-[17px]" />
      <div className="flex items-center gap-2">
        <SubmitButton size="sm">Save</SubmitButton>
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
          Cancel
        </Button>
        {!locked && <span className="text-[12.5px] text-ink-mute">The AI won&apos;t rename it after this.</span>}
      </div>
    </form>
  );
}

/** Shown next to a field a human has set, so people know the AI will leave it alone. */
export function LockedHint({ locked }: { locked: boolean }) {
  if (!locked) return null;
  return <Lock className="size-3 text-ink-mute" aria-label="set by a person; the AI won't change it" />;
}

export function PriorityEditor({ priority, onSave }: { priority: Priority; onSave: Save<Priority> }) {
  const [shown, setShown] = useOptimistic(priority);
  const [, start] = useTransition();
  return (
    <div role="radiogroup" aria-label="Priority" className="grid grid-cols-4 gap-1 rounded-2xl bg-sand p-1">
      {PRIORITIES.map((p) => (
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={shown === p}
          onClick={() =>
            shown !== p &&
            start(async () => {
              setShown(p);
              const r = await onSave(p);
              if (!r.ok) toast.error(r.error);
            })
          }
          className={cn(
            "flex min-h-10 items-center justify-center gap-1.5 rounded-xl text-[13.5px] font-medium capitalize transition-colors",
            shown === p ? "bg-paper text-ink shadow-sm" : "text-ink-soft hover:bg-paper hover:text-ink",
          )}
        >
          <PriorityDot priority={p} />
          {p}
        </button>
      ))}
    </div>
  );
}

/** A date (IST day) saved on change; due means the end of that day. */
export function DueEditor({ day, onSave }: { day: string; onSave: Save<string> }) {
  const [value, setValue] = useState(day);
  const [pending, start] = useTransition();
  const save = (v: string) =>
    start(async () => {
      setValue(v);
      const r = await onSave(v);
      if (!r.ok) {
        toast.error(r.error);
        setValue(day);
      }
    });
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="due" className="sr-only">
        Due date
      </label>
      <Input id="due" type="date" value={value} onChange={(e) => save(e.target.value)} disabled={pending} className="h-10 flex-1" />
      {value && (
        <Button type="button" variant="ghost" size="sm" onClick={() => save("")} disabled={pending}>
          Clear
        </Button>
      )}
    </div>
  );
}
