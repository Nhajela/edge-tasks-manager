"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { SubmitButton } from "@/components/feedback";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/types";

/** Comment + "Tell <person> on Telegram" (default on). `tellName` null = nobody else to tell (e.g. your own request). */
export function CommentBox({ tellName, onSend }: { tellName: string | null; onSend: (text: string, notify: boolean) => Promise<ActionResult> }) {
  const [notify, setNotify] = useState(true);
  const form = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={form}
      action={async (fd) => {
        const r = await onSend(String(fd.get("text") ?? ""), tellName != null && notify);
        if (!r.ok) return void toast.error(r.error);
        form.current?.reset();
        toast.success(tellName && notify ? `Sent. ${tellName} will get it on Telegram.` : "Comment added.");
      }}
      className="flex flex-col gap-2.5"
    >
      <label htmlFor="comment" className="sr-only">
        Comment
      </label>
      <Textarea id="comment" name="text" required maxLength={4000} rows={3} placeholder="Add a comment or an update…" className="min-h-20 text-[15px]" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        {tellName ? (
          <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-[14px] text-ink-soft">
            <Switch checked={notify} onCheckedChange={setNotify} />
            Tell {tellName} on Telegram
          </label>
        ) : (
          <span />
        )}
        <SubmitButton pendingLabel="Sending…">Comment</SubmitButton>
      </div>
    </form>
  );
}
