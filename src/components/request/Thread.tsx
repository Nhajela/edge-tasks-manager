import { CornerDownRight } from "lucide-react";
import { displayName } from "@/lib/names";
import type { Attachment } from "@/lib/types";
import type { DetailMessage } from "@/services/requests";
import { MessageCard } from "./MessageCard";

type QuoteSource = Pick<DetailMessage, "chatId" | "messageId" | "replyToMessageId" | "from" | "text">;

/** "↳ replying to <name>: <snippet>" for a thread message, or null when it doesn't reply to a known message. */
export function replyQuote(m: QuoteSource, all: QuoteSource[], botConfirmMessageId: number | null): { name: string; snippet: string } | null {
  if (m.replyToMessageId == null) return null;
  if (m.replyToMessageId === botConfirmMessageId) return { name: "the bot", snippet: "request confirmation" };
  const target = all.find((x) => x.chatId === m.chatId && x.messageId === m.replyToMessageId);
  if (!target) return null;
  const text = target.text.replace(/\s+/g, " ").trim();
  return { name: displayName(target.from), snippet: text.length > 80 ? text.slice(0, 80) + "…" : text };
}

/** The reply thread: flat and chronological (readable on a phone), each message quoting what it answered. */
export function Thread({
  messages,
  all,
  attachments,
  botConfirmMessageId,
}: {
  messages: DetailMessage[];
  /** every message on the request, so a reply to the original or an append can be quoted too */
  all: DetailMessage[];
  attachments: Attachment[];
  botConfirmMessageId: number | null;
}) {
  if (!messages.length) return null;
  return (
    <ol className="flex flex-col gap-2.5">
      {messages.map((m) => {
        const q = replyQuote(m, all, botConfirmMessageId);
        return (
          <li key={m.id}>
            <MessageCard
              message={m}
              attachments={attachments}
              compact
              quote={
                q && (
                  <p className="flex min-w-0 items-center gap-1 text-[12.5px] text-ink-mute">
                    <CornerDownRight className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">
                      replying to <span className="font-medium text-ink-soft">{q.name}</span>: {q.snippet}
                    </span>
                  </p>
                )
              }
            />
          </li>
        );
      })}
    </ol>
  );
}
