"use server";

import { db } from "@/db";
import { getViewer } from "@/lib/viewer";
import { ServiceError } from "@/services/errors";
import * as tokens from "@/services/tokens";
import type { TokenInfo } from "@/services/tokens";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

async function run<T>(fn: (actor: NonNullable<Awaited<ReturnType<typeof getViewer>>>["actor"]) => Promise<T>): Promise<Result<T>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: "You're logged out. Reload and log in again." };
  try {
    return { ok: true, ...(await fn(viewer.actor)) };
  } catch (e) {
    if (e instanceof ServiceError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function listMcpTokens(): Promise<Result<{ tokens: TokenInfo[] }>> {
  return run(async (actor) => ({ tokens: await tokens.list(db(), actor) }));
}

/** The raw token is returned once and never again. */
export async function createMcpToken(name: string): Promise<Result<{ token: string }>> {
  return run(async (actor) => ({ token: (await tokens.create(db(), actor, { name })).token }));
}

export async function revokeMcpToken(id: number): Promise<Result<object>> {
  if (!Number.isInteger(id)) return { ok: false, error: "No such token." };
  return run(async (actor) => {
    await tokens.revoke(db(), actor, id);
    return {};
  });
}
