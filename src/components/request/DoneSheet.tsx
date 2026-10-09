"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Spinner } from "@/components/feedback";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/types";
import { cn } from "@/lib/utils";

/** A thread/original message offered in the "use a message from the thread" picker (built on the server). */
export type PickMessage = { id: number; name: string; snippet: string; media: number };
export type DoneResult = { note: string | null; messageId: number | null };

/** "What was delivered? (optional)": a note and/or one message from the thread. Both empty = plain done. */
export function DoneSheet({
  open,
  onOpenChange,
  messages,
  initialMessageId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messages: PickMessage[];
  initialMessageId: number | null;
  onDone: (result: DoneResult) => Promise<ActionResult>;
}) {
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<number | null>(initialMessageId);
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      const r = await onDone({ note: note.trim() || null, messageId: picked });
      if (!r.ok) return void toast.error(r.error);
      onOpenChange(false);
      setNote("");
      toast.success("Marked done.");
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[17px]">What was delivered? (optional)</DialogTitle>
          <DialogDescription>It shows at the top of the request and in the done message.</DialogDescription>
        </DialogHeader>
        <label htmlFor="done-note" className="sr-only">
          Note
        </label>
        <Textarea
          id="done-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={4000}
          rows={2}
          placeholder="e.g. Projector fixed, new HDMI cable"
          className="min-h-16 text-[15px]"
        />
        {messages.length > 0 && (
          <fieldset className="flex min-w-0 flex-col gap-1.5">
            <legend className="mb-1.5 text-[13px] font-semibold text-ink-mute">Use a message from the thread</legend>
            {[{ id: null, name: "None", snippet: "", media: 0 } as const, ...messages].map((m) => (
              <label
                key={m.id ?? "none"}
                className={cn(
                  "flex min-h-11 min-w-0 cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-[14px]",
                  picked === m.id ? "border-teal bg-teal-tint" : "border-line-soft",
                )}
              >
                <input type="radio" name="deliverable" checked={picked === m.id} onChange={() => setPicked(m.id)} className="size-4 shrink-0 accent-[var(--teal)]" />
                <span className="min-w-0 flex-1 truncate pl-0.5">
                  <span className="font-medium text-ink">{m.name}</span>
                  {m.snippet && <span className="text-ink-soft">: {m.snippet}</span>}
                </span>
                {m.media > 0 && <span className="shrink-0 text-[12.5px] text-ink-mute">📎 {m.media}</span>}
              </label>
            ))}
          </fieldset>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={submit} disabled={pending}>
            {pending && <Spinner />}
            Mark done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** ⭐ Mark as deliverable, on each original/thread message (shown only to the assignee, requester and admins). */
export function MarkDeliverableButton({ current, done, onMark }: { current: boolean; done: boolean; onMark: () => Promise<ActionResult> }) {
  const [pending, start] = useTransition();
  if (current) return <span className="py-1 text-[13px] font-medium text-teal-deep">⭐ Deliverable</span>;
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await onMark();
          if (!r.ok) toast.error(r.error);
          else toast.success(done ? "Marked as the deliverable." : "Marked as the deliverable. It shows once this is done.");
        })
      }
      className="inline-flex min-h-8 items-center gap-1 py-1 text-[13px] font-medium text-ink-soft underline-offset-2 hover:text-ink hover:underline disabled:opacity-60"
    >
      {pending ? <Spinner className="size-3.5" /> : "⭐"} Mark as deliverable
    </button>
  );
}
