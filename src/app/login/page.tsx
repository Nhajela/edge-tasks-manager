import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Column, Mark } from "@/components/bits";
import { SubmitButton } from "@/components/feedback";
import { Button } from "@/components/ui/button";
import { redeemLogin } from "@/app/auth/actions";
import { peekClaimedCode } from "@/lib/login";
import { getSession } from "@/lib/session";
import { safeNext } from "@/lib/links";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Log in · Edge Tasks", robots: { index: false } };

const BOT = process.env.TELEGRAM_BOT_USERNAME || "edge_tasks_bot";
const name = (s: { username: string | null; firstName: string }) => (s.username ? `@${s.username}` : s.firstName || "you");

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ code?: string; next?: string }> }) {
  const { code = "", next: rawNext } = await searchParams;
  const next = safeNext(rawNext);
  const [target, current] = await Promise.all([code ? peekClaimedCode(code) : null, getSession()]);
  if (current && (!target || current.telegramId === target.telegramId) && rawNext) redirect(next);
  if (target && current?.telegramId === target.telegramId) redirect(next);

  return (
    <main className="flex flex-1 items-center py-16">
      <Column className="flex flex-col gap-5">
        <Mark size={36} />
        {target ? (
          <>
            <h1 className="display text-[36px] font-bold leading-tight sm:text-[48px]">Continue as {name(target)}?</h1>
            <p className="max-w-[44ch] text-[16px] leading-7 text-ink-soft">
              {current
                ? `You're logged in as ${name(current)} in this browser. Continuing switches to ${name(target)}.`
                : "This link came from our Telegram bot. Only continue if you asked for it yourself."}
            </p>
            <form action={redeemLogin} className="flex flex-wrap gap-3">
              <input type="hidden" name="code" value={code} />
              <input type="hidden" name="next" value={next} />
              <SubmitButton size="lg" pendingLabel="Logging you in…">
                Continue as {name(target)}
              </SubmitButton>
              <Button size="lg" variant="ghost" render={<Link href="/" />}>
                Not me
              </Button>
            </form>
          </>
        ) : (
          <>
            <h1 className="display text-[36px] font-bold leading-tight sm:text-[48px]">That login link has expired.</h1>
            <p className="max-w-[44ch] text-[16px] leading-7 text-ink-soft">
              Links from the bot work once, for 30 minutes. Send any message to{" "}
              <a className="underline" href={`https://t.me/${BOT}`}>
                @{BOT}
              </a>{" "}
              for a fresh one, or log in from the home page.
            </p>
            <div>
              <Button size="lg" render={<Link href="/" />}>
                Back home
              </Button>
            </div>
          </>
        )}
      </Column>
    </main>
  );
}
