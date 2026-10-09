import { redirect } from "next/navigation";
import { Column, Mark } from "@/components/bits";
import { CommandBubble } from "@/components/EmptyState";
import { LoginButton } from "@/components/LoginButton";
import { safeNext } from "@/lib/links";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const BOT = process.env.TELEGRAM_BOT_USERNAME || "edge_tasks_bot";

export default async function Home({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await getSession()) redirect(next ? safeNext(next) : "/inbox");
  return (
    <main className="flex flex-1 items-center py-10 sm:py-16">
      <Column wide className="grid items-center gap-10 md:grid-cols-[1.1fr_1fr] md:gap-14">
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-2">
            <Mark size={30} />
            <span className="text-[16px] font-semibold tracking-tight">Edge Tasks</span>
          </div>
          <h1 className="display text-[34px] font-bold leading-[1.08] sm:text-[52px]">
            Ask anyone at Edge City for something, right from Telegram.
          </h1>
          <p className="max-w-[46ch] text-[16px] leading-7 text-ink-soft">
            Type a command in any group with{" "}
            <a className="font-medium text-ink underline decoration-line underline-offset-2" href={`https://t.me/${BOT}`}>
              @{BOT}
            </a>
            . Everything you asked for, and everything asked of you, lands here.
          </p>
          <LoginButton />
        </div>

        <div className="rounded-[var(--radius-card)] border border-line-soft bg-sand p-4 sm:p-5">
          <p className="mb-3 text-center text-[12.5px] font-medium text-ink-mute">In any Telegram group</p>
          <ul className="flex flex-col gap-4">
            <CommandBubble k="request" />
            <li className="flex flex-col items-start gap-1">
              <span className="max-w-[92%] rounded-2xl rounded-bl-md bg-paper px-3.5 py-2 text-[15px] leading-5 shadow-sm">
                <span className="block text-[12.5px] font-semibold text-blue-deep">Edge Tasks</span>
                📝 #12 for @bob: Fix the dome projector
              </span>
            </li>
            <CommandBubble k="reply" />
            <CommandBubble k="mine" />
          </ul>
        </div>
      </Column>
    </main>
  );
}
