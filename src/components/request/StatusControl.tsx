"use client";

import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { SubmitButton } from "@/components/feedback";
import { Input } from "@/components/ui/input";
import { STATUSES, STATUS_LABEL } from "@/lib/constants";
import type { ActionResult, Status } from "@/lib/types";
import { cn } from "@/lib/utils";

const SUGGESTIONS = ["On my way", "Ordering it", "Checking", "Waiting on a vendor", "Waiting for a reply", "Tomorrow morning", "Need more info"];

const ON: Record<Status, string> = {
  open: "bg-blue-tint text-blue-deep",
  in_progress: "bg-teal-tint text-teal-deep",
  waiting: "bg-marigold-tint text-ink",
  done: "bg-ink text-paper",
  declined: "bg-danger-tint text-danger",
};

/** Open · Doing · Waiting · Done · Declined, plus a free "custom label" shown instead of the status name. */
export function StatusControl({
  status,
  customStatus,
  onChange,
}: {
  status: Status;
  customStatus: string | null;
  /** customStatus undefined = keep it when the status is unchanged, clear it otherwise */
  onChange: (status: Status, customStatus: string | null | undefined) => Promise<ActionResult>;
}) {
  const [shown, setShown] = useOptimistic(status);
  const [, start] = useTransition();
  const [label, setLabel] = useState(customStatus ?? "");

  const pick = (s: Status) =>
    start(async () => {
      setShown(s);
      const r = await onChange(s, undefined);
      if (!r.ok) toast.error(r.error);
      else if (s !== status) setLabel("");
    });

  const saveLabel = async (fd: FormData) => {
    const v = String(fd.get("label") ?? "").trim();
    const r = await onChange(status, v || null);
    if (!r.ok) toast.error(r.error);
    else toast.success(v ? `Label set: ${v}` : "Label cleared");
  };

  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Status" className="grid grid-cols-5 gap-1 rounded-2xl bg-sand p-1">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={shown === s}
            onClick={() => shown !== s && pick(s)}
            className={cn(
              "min-h-11 rounded-xl px-1 text-[13.5px] font-medium transition-colors sm:text-[14.5px]",
              shown === s ? cn(ON[s], "shadow-sm") : "text-ink-soft hover:bg-paper hover:text-ink",
            )}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      <form action={saveLabel} className="flex items-center gap-2">
        <label htmlFor="custom-status" className="sr-only">
          Custom label
        </label>
        <Input
          id="custom-status"
          name="label"
          list="status-suggestions"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={`Custom label, e.g. “Ordering from Panjim”`}
          maxLength={100}
          className="h-10 flex-1"
        />
        <datalist id="status-suggestions">
          {SUGGESTIONS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <SubmitButton variant="outline" size="default">
          {label.trim() || !customStatus ? "Set" : "Clear"}
        </SubmitButton>
      </form>
    </div>
  );
}
