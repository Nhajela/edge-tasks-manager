import { cache } from "react";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { actorFromSession } from "./actor";
import { getSession } from "./session";

/** The logged-in person + Actor for this request (deduped per render), or null when logged out. */
export const getViewer = cache(async () => {
  const session = await getSession();
  if (!session) return null;
  return { session, ...(await actorFromSession(db(), session)) };
});

/** Same, but sends logged-out visitors to the home page (which brings them back after login). */
export async function requireViewer(next = "/inbox") {
  const v = await getViewer();
  if (!v) redirect(`/?next=${encodeURIComponent(next)}`);
  return v;
}
