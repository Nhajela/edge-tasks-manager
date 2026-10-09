"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { db } from "@/db";
import { runEffects } from "@/lib/effects";
import type { Status } from "@/lib/types";
import { getViewer } from "@/lib/viewer";
import { ServiceError, errorMessage } from "@/services/errors";
import * as requests from "@/services/requests";

export type RowStatusResult = { ok: true } | { ok: false; error: string };

/**
 * Quick "Mark done" (and its Undo, which passes the previous status + custom label back) from a list row.
 * The service validates the status and checks the viewer may manage the request.
 */
export async function setRowStatus(id: number, status: Status, customStatus: string | null): Promise<RowStatusResult> {
  try {
    const viewer = await getViewer();
    if (!viewer) return { ok: false, error: "Log in again to change this." };
    if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, error: "Unknown request." };
    const { effects } = await requests.setStatus(db(), viewer.actor, id, { status, customStatus: customStatus ?? null });
    after(() => runEffects(effects));
    refresh();
    return { ok: true };
  } catch (e) {
    if (!(e instanceof ServiceError)) console.error("setRowStatus failed", e);
    return { ok: false, error: errorMessage(e) };
  }
}
