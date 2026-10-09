"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordLogin, redeemCode } from "@/lib/login";
import { safeNext } from "@/lib/links";
import { clearPendingCode, clearSession, setSession } from "@/lib/session";

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
};

/** "Continue as …" on /login?code= (magic links from the bot). */
export async function redeemLogin(fd: FormData): Promise<void> {
  const state = await redeemCode(str(fd, "code"));
  if (state.status !== "ok") redirect("/login");
  await setSession(state.session);
  await recordLogin(state.session, "Logged in via a bot link");
  await clearPendingCode();
  revalidatePath("/", "layout");
  redirect(safeNext(str(fd, "next")));
}

export async function logout(): Promise<void> {
  await clearSession();
  revalidatePath("/", "layout");
  redirect("/");
}
