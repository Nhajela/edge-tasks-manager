import { NextResponse } from "next/server";

const NO_STORE = { headers: { "cache-control": "no-store" } };
import { recordLogin, redeemCode } from "@/lib/login";
import { clearPendingCode, getPendingCode, setSession } from "@/lib/session";

export async function GET() {
  const code = await getPendingCode();
  if (!code) return NextResponse.json({ status: "expired" }, NO_STORE);

  const state = await redeemCode(code);
  if (state.status === "ok") {
    await setSession(state.session);
    await recordLogin(state.session, "Logged in from the website");
    await clearPendingCode();
    return NextResponse.json({ status: "ok" }, NO_STORE);
  }
  if (state.status === "expired") await clearPendingCode();
  return NextResponse.json({ status: state.status }, NO_STORE);
}
