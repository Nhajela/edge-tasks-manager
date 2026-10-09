import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The bot commands people actually need, in the words the bot understands. */
export const COMMANDS = {
  request: { text: "/request @bob fix the projector in the dome", note: "Ask someone for something" },
  organiser: { text: "/request more water at the front desk", note: "No @name? It goes to the organiser" },
  reply: { text: "/request", note: "Reply to a message with this to take it on yourself", reply: "can someone grab chairs for the talk?" },
  mine: { text: "/mine", note: "What's on your plate, right in Telegram" },
  raised: { text: "/raised", note: "What you've asked others for" },
  append: { text: "/append", note: "Reply to a message to add it to your last request" },
} satisfies Record<string, { text: string; note: string; reply?: string }>;

export type CommandKey = keyof typeof COMMANDS;

/** One outgoing Telegram-style message bubble with a caption under it. */
export function CommandBubble({ k, className }: { k: CommandKey; className?: string }) {
  const c: { text: string; note: string; reply?: string } = COMMANDS[k];
  return (
    <li className={cn("flex flex-col items-end gap-1", className)}>
      <span className="max-w-full rounded-2xl rounded-br-md bg-teal px-3.5 py-2 text-[15px] leading-5 text-white shadow-sm">
        {c.reply && (
          <span className="mb-1 block border-l-2 border-white/60 pl-2 text-[13px] leading-4 text-white/80">{c.reply}</span>
        )}
        <span className="font-mono text-[14px] break-words">{c.text}</span>
      </span>
      <span className="pr-1 text-right text-[13px] leading-4 text-ink-mute">{c.note}</span>
    </li>
  );
}

/**
 * Empty list placeholder that teaches the bot. Requests are created from Telegram, so the empty state
 * says how, instead of offering a button that doesn't exist.
 */
export function EmptyState({
  title,
  children,
  commands = ["request", "reply"],
  className,
}: {
  title: string;
  children?: ReactNode;
  commands?: CommandKey[];
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-4 rounded-[var(--radius-card)] border border-line-soft bg-sand px-4 py-5 sm:px-6", className)}>
      <div className="flex flex-col gap-1">
        <h2 className="text-[18px] font-semibold tracking-tight">{title}</h2>
        {children && <div className="text-[14.5px] leading-6 text-ink-soft">{children}</div>}
      </div>
      {commands.length > 0 && (
        <ul className="flex flex-col gap-3" aria-label="Try in Telegram">
          {commands.map((k) => (
            <CommandBubble key={k} k={k} />
          ))}
        </ul>
      )}
    </section>
  );
}
