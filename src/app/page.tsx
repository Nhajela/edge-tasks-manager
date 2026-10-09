import { redirect } from "next/navigation";
import { Column, Mark } from "@/components/bits";
import { LoginButton } from "@/components/LoginButton";
import { safeNext } from "@/lib/links";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const BOT = process.env.TELEGRAM_BOT_USERNAME || "edge_tasks_bot";

const EXAMPLES = [
  { cmd: "/request @bob fix the projector in the dome", note: "Ask someone for something" },
  { cmd: "/request more water at the front desk", note: "No @? It goes to the organiser" },
  { cmd: "/mine", note: "What's on your plate" },
];

// ponytail: placeholder explainer; the web UI agent owns the final design
export default async function Home({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await getSession()) redirect(next ? safeNext(next) : "/inbox");
  return (
    <main className="flex flex-1 items-center py-12">
      <Column className="flex flex-col gap-6">
        <Mark size={36} />
        <h1 className="display text-[36px] font-bold leading-tight sm:text-[48px]">
          Ask anyone at Edge City for something, right from Telegram.
        </h1>
        <ul className="flex flex-col gap-3">
          {EXAMPLES.map((e) => (
            <li key={e.cmd} className="flex flex-col gap-1">
              <span className="w-fit rounded-2xl rounded-bl-sm bg-teal-tint px-3.5 py-2 font-mono text-[14.5px] text-teal-deep">{e.cmd}</span>
              <span className="text-[13.5px] text-ink-mute">{e.note}</span>
            </li>
          ))}
        </ul>
        <p className="text-[15px] text-ink-soft">
          Add{" "}
          <a className="underline" href={`https://t.me/${BOT}`}>
            @{BOT}
          </a>{" "}
          to your group, then track everything here.
        </p>
        <div>
          <LoginButton />
        </div>
      </Column>
    </main>
  );
}
