import type { Metadata } from "next";
import { Column, Mark, Note } from "@/components/bits";
import { LoginButton } from "@/components/LoginButton";
import { Button } from "@/components/ui/button";
import { readAuthRequest } from "@/lib/oauth/authorize";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connect an AI app · Edge Tasks", robots: { index: false } };

/** Where the code goes after Allow. Shown so a person who didn't start this from their own app can stop. */
function returnTarget(redirectUri: string): string {
  try {
    const u = new URL(redirectUri);
    return u.protocol === "http:" || u.protocol === "https:" ? u.host : `${u.protocol}//`;
  } catch {
    return "the app that asked";
  }
}

const name = (s: { username: string | null; firstName: string }) => (s.username ? `@${s.username}` : s.firstName || "you");

/** OAuth consent for MCP clients: log in with Telegram if needed, then Allow or Don't allow. */
export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ req?: string }> }) {
  const { req = "" } = await searchParams;
  const auth = req ? readAuthRequest(req) : null;
  const session = auth ? await getSession() : null;

  return (
    <main className="flex flex-1 items-center py-16">
      <Column className="flex flex-col gap-5">
        <Mark size={36} />
        {!auth ? (
          <>
            <h1 className="display text-[36px] font-bold leading-tight sm:text-[48px]">This sign-in link has expired.</h1>
            <p className="max-w-[44ch] text-[16px] leading-7 text-ink-soft">
              Links from AI apps last 15 minutes. Go back to your AI app and connect Edge Tasks again.
            </p>
          </>
        ) : (
          <>
            <h1 className="display text-[36px] font-bold leading-tight sm:text-[48px]">Connect {auth.clientName}?</h1>
            <p className="max-w-[48ch] text-[16px] leading-7 text-ink-soft">
              {auth.clientName} wants to use Edge Tasks as {session ? name(session) : "you"}. It can read the requests you can
              see, ask people for things, comment, and change status, due date and priority. Those changes message people on
              Telegram, just as if you made them.
            </p>
            <Note>
              You&rsquo;ll be sent back to <b className="font-mono">{returnTarget(auth.redirectUri)}</b>. If that isn&rsquo;t the
              app you opened, close this page.
            </Note>
            {session ? (
              <>
                <form method="post" action="/oauth/authorize" className="flex flex-wrap gap-3">
                  <input type="hidden" name="req" value={req} />
                  <Button type="submit" size="lg" name="decision" value="allow">
                    Allow
                  </Button>
                  <Button type="submit" size="lg" variant="ghost" name="decision" value="deny">
                    Don&rsquo;t allow
                  </Button>
                </form>
                <p className="text-[14px] leading-6 text-ink-mute">
                  You can disconnect it any time: it shows up as a token under “AI assistant access” in Settings, where you can revoke it.
                </p>
              </>
            ) : (
              <>
                <p className="text-[16px] leading-7 text-ink-soft">Log in first. This page continues by itself when you&rsquo;re back.</p>
                <LoginButton />
              </>
            )}
          </>
        )}
      </Column>
    </main>
  );
}
