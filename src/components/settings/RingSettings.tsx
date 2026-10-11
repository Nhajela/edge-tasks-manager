"use client";

import { useActionState } from "react";
import { saveRing, testRing } from "@/app/(app)/settings/ring-actions";
import { Note } from "@/components/bits";
import { Spinner } from "@/components/feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { RingSettings as Settings } from "@/services/ring";

/** The topic + who may ring you (empty = anyone), and a test button. Explained on /settings/ring. */
export function RingSettings({ initial, suggested }: { initial: Settings | null; suggested: string }) {
  const [state, save, saving] = useActionState(saveRing, null);
  const [test, ring, ringing] = useActionState(testRing, null);
  return (
    <div className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-line-soft bg-card p-4">
      <form action={save} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ring-topic">ntfy topic</Label>
          <Input id="ring-topic" name="topic" defaultValue={initial?.ntfyTopic ?? suggested} maxLength={64} autoComplete="off" className="font-mono" />
          <p className="text-[13px] text-ink-mute">Empty it and save to turn ringing off.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ring-allow">Who can ring you</Label>
          <Input id="ring-allow" name="allowFrom" defaultValue={initial?.allowFrom.map((u) => `@${u}`).join(", ") ?? ""} placeholder="Anyone (or: @alice, @bob)" autoComplete="off" />
          <p className="text-[13px] text-ink-mute">Leave empty and anyone can. Add usernames to allow only them.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={saving}>
            {saving && <Spinner />}
            Save
          </Button>
          <Button type="submit" variant="outline" formAction={ring} disabled={ringing || !initial}>
            {ringing && <Spinner />}
            Send a test ring
          </Button>
        </div>
      </form>
      {[state, test].map(
        (r, i) =>
          r && (
            <Note key={i} tone={r.ok ? "teal" : "danger"} role={r.ok ? "status" : "alert"}>
              {r.message}
            </Note>
          ),
      )}
    </div>
  );
}
