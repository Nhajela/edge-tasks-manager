"use server";

import { after } from "next/server";
import { refresh } from "next/cache";
import { db } from "@/db";
import { runEffects } from "@/lib/effects";
import { requireViewer } from "@/lib/viewer";
import * as aiContext from "@/services/aiContext";
import { ServiceError } from "@/services/errors";
import * as requests from "@/services/requests";
import type { Actor } from "@/services/types";
import { answerQuestion, dismissQuestion } from "./ops";

export type ActionResult = { ok?: string; error?: string };

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const num = (fd: FormData, k: string) => (fd.get(k) ? Number(fd.get(k)) : undefined);

/** Thin adapter: viewer -> service -> refresh. Service errors become a message for the toast. */
async function run(fn: (actor: Actor) => Promise<string>): Promise<ActionResult> {
  const { actor } = await requireViewer("/context");
  try {
    const ok = await fn(actor);
    refresh();
    return { ok };
  } catch (e) {
    if (e instanceof ServiceError) return { error: e.message };
    throw e;
  }
}

const retitle = (ids: number[]) => after(() => runEffects(ids.map((requestId) => ({ kind: "title" as const, requestId }))));

/** /context (by questionId) and the /r/[id] card (by requestId + question). Re-titles when "retitle" is on. */
export async function answerAction(fd: FormData): Promise<ActionResult> {
  return run(async (actor) => {
    const { requestId } = await answerQuestion(db(), actor, {
      questionId: num(fd, "questionId"),
      requestId: num(fd, "requestId"),
      question: str(fd, "question") || null,
      text: str(fd, "answer"),
    });
    if (requestId != null && fd.get("retitle") === "on") {
      retitle([requestId]);
      return `Saved. Re-titling #${requestId}.`;
    }
    return "Saved.";
  });
}

export async function dismissAction(fd: FormData): Promise<ActionResult> {
  return run(async (actor) => (await dismissQuestion(db(), actor, Number(fd.get("id"))), "Dismissed."));
}

export async function addFactAction(fd: FormData): Promise<ActionResult> {
  return run(async (actor) => (await aiContext.addFact(db(), actor, str(fd, "text")), "Fact added."));
}

export async function updateFactAction(fd: FormData): Promise<ActionResult> {
  return run(async (actor) => (await aiContext.updateFact(db(), actor, Number(fd.get("id")), str(fd, "text")), "Saved."));
}

export async function removeAction(fd: FormData): Promise<ActionResult> {
  return run(async (actor) => (await aiContext.remove(db(), actor, Number(fd.get("id"))), "Deleted."));
}

export async function retitleRecentAction(): Promise<ActionResult> {
  return run(async (actor) => {
    const { items } = await requests.listAll(db(), actor, { status: "all", limit: 20 });
    retitle(items.map((r) => r.id));
    return `Re-titling ${items.length} request${items.length === 1 ? "" : "s"}. Titles people edited stay.`;
  });
}
