import { eq } from "drizzle-orm";
import { attachments } from "@/db/schema";
import type { Attachment } from "@/lib/types";
import type { DbClient } from "./types";

/** For the signed /api/files/<id> proxy: the signature is the authorization, so no actor. */
export async function getById(db: DbClient, id: number): Promise<Attachment | null> {
  const [row] = await db.select().from(attachments).where(eq(attachments.id, id));
  return row ?? null;
}
