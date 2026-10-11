"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { SITE_URL } from "@/lib/constants";
import { sendRing } from "@/lib/effects";
import { getViewer } from "@/lib/viewer";
import { ServiceError } from "@/services/errors";
import * as ring from "@/services/ring";

export type RingState = { ok: boolean; message: string } | null;

export async function saveRing(_prev: RingState, form: FormData): Promise<RingState> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, message: "You're logged out. Reload and log in again." };
  try {
    const s = await ring.setMine(db(), viewer.actor, { ntfyTopic: String(form.get("topic") ?? ""), allowFrom: String(form.get("allowFrom") ?? "") });
    revalidatePath("/settings/ring");
    return { ok: true, message: !s ? "Urgent ring is off." : s.allowFrom.length ? `Saved. Only ${s.allowFrom.map((u) => `@${u}`).join(", ")} can ring you.` : "Saved. Anyone can ring you." };
  } catch (e) {
    if (e instanceof ServiceError) return { ok: false, message: e.message };
    throw e;
  }
}

/** Ring my saved topic now, so I can check the phone side before relying on it. */
export async function testRing(): Promise<RingState> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, message: "You're logged out. Reload and log in again." };
  const s = await ring.getMine(db(), viewer.actor);
  if (!s) return { ok: false, message: "Save a topic first." };
  try {
    await sendRing({ kind: "ring", topic: s.ntfyTopic, title: "Test ring from Edge Tasks. If your phone made noise, you're set.", url: `${SITE_URL}/settings/ring` });
    return { ok: true, message: "Sent. Your phone should be ringing." };
  } catch (e) {
    console.error("test ring failed", e);
    return { ok: false, message: "ntfy didn't accept it. Try again in a minute." };
  }
}
