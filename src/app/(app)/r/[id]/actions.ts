"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { db } from "@/db";
import { runEffects } from "@/lib/effects";
import type { ActionResult, Priority, Status } from "@/lib/types";
import { getViewer } from "@/lib/viewer";
import { errorMessage } from "@/services/errors";
import * as requests from "@/services/requests";
import type { Actor, Effect } from "@/services/types";

/** Thin adapter: viewer -> service -> schedule effects -> re-render the page. Errors become a message for a toast. */
async function run(id: number, fn: (actor: Actor) => Promise<object>): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: "You're logged out. Reload the page to log in again." };
  try {
    const res = await fn(viewer.actor);
    const effects: Effect[] = "effects" in res ? (res.effects as Effect[]) : [];
    if (effects.length) after(() => runEffects(effects));
    refresh();
    return { ok: true };
  } catch (e) {
    console.error(`/r/${id} action failed`, e);
    return { ok: false, error: errorMessage(e) };
  }
}

export async function setStatusAction(id: number, status: Status, customStatus?: string | null): Promise<ActionResult> {
  return run(id, (a) => requests.setStatus(db(), a, id, { status, customStatus }));
}

/** Done from the "What was delivered?" sheet. The note is the status note (timeline, notification) and the result note. */
export async function doneAction(id: number, result: { note: string | null; messageId: number | null }): Promise<ActionResult> {
  return run(id, (a) => requests.setStatus(db(), a, id, { status: "done", note: result.note, result: { messageId: result.messageId } }));
}

/** ⭐ messageId is a request_messages.id of this request. */
export async function markDeliverableAction(id: number, messageId: number): Promise<ActionResult> {
  return run(id, (a) => requests.markDeliverable(db(), a, id, messageId));
}

export async function setTitleAction(id: number, title: string): Promise<ActionResult> {
  return run(id, (a) => requests.setTitle(db(), a, id, title));
}

export async function setPriorityAction(id: number, priority: Priority): Promise<ActionResult> {
  return run(id, (a) => requests.setPriority(db(), a, id, priority));
}

/** `day` is an IST calendar day ("2026-10-15"); due means the end of that day. Empty clears it. */
export async function setDueAction(id: number, day: string): Promise<ActionResult> {
  return run(id, (a) => requests.setDue(db(), a, id, day ? new Date(`${day}T23:59:00+05:30`) : null));
}

export async function commentAction(id: number, text: string, notify: boolean): Promise<ActionResult> {
  return run(id, (a) => requests.comment(db(), a, id, { text, notify }));
}
