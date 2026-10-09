import { NextResponse, type NextRequest } from "next/server";

/**
 * Old-style magic links (/api/auth/redeem?code=…) now go through a confirm page,
 * so link scanners can't burn the code and nobody gets silently logged in as someone else.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code") ?? "";
  const url = new URL("/login", req.nextUrl.origin);
  if (code) url.searchParams.set("code", code);
  return NextResponse.redirect(url, 303);
}
