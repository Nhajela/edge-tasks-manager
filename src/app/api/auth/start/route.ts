import { NextResponse } from "next/server";

const NO_STORE = { headers: { "cache-control": "no-store" } };
import { BOT_USERNAME } from "@/lib/constants";
import { createCode } from "@/lib/login";
import { setPendingCode } from "@/lib/session";

export async function POST() {
  if (!BOT_USERNAME) {
    return NextResponse.json({ error: "Telegram bot is not configured yet." }, { status: 503, ...NO_STORE });
  }
  const code = await createCode();
  await setPendingCode(code);
  return NextResponse.json({ url: `https://t.me/${BOT_USERNAME}?start=${code}` }, NO_STORE);
}
