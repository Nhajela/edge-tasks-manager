import { type Bubble, STEPS, withBot } from "./tutorial-content";

function ChatBubble({ b, bot }: { b: Bubble; bot: string }) {
  const you = b.from === "you";
  const mono = b.from !== "bot" && /^[/@]/.test(b.text); // commands look typed; plain chat stays plain
  return (
    <li className={you ? "flex flex-col items-end" : "flex flex-col items-start"}>
      <span
        className={
          you
            ? "max-w-[92%] rounded-2xl rounded-br-md bg-teal px-3.5 py-2 text-[15px] leading-5 text-white shadow-sm"
            : "max-w-[92%] rounded-2xl rounded-bl-md bg-paper px-3.5 py-2 text-[15px] leading-5 text-ink shadow-sm"
        }
      >
        {b.name && <span className="block text-[12.5px] font-semibold text-blue-deep">{b.name}</span>}
        {b.reply && (
          <span
            className={`mb-1 block truncate border-l-2 pl-2 text-[13px] leading-4 ${you ? "border-white/60 text-white/80" : "border-teal text-ink-soft"}`}
          >
            {withBot(b.reply, bot)}
          </span>
        )}
        <span className={`whitespace-pre-line break-words ${mono ? "font-mono text-[14px]" : ""}`}>{withBot(b.text, bot)}</span>
      </span>
    </li>
  );
}

/** "How it works": numbered steps, each with a Telegram-style chat mock. */
export function Steps({ bot }: { bot: string }) {
  return (
    <ol className="flex flex-col gap-6">
      {STEPS.map((s, i) => (
        <li key={s.title} className="grid gap-3 sm:grid-cols-[1fr_1.1fr] sm:gap-6">
          <div className="flex gap-3">
            <span
              aria-hidden
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-[13.5px] font-semibold text-paper tnum"
            >
              {i + 1}
            </span>
            <div className="flex min-w-0 flex-col gap-1.5">
              <h3 className="text-[17px] font-semibold leading-6 tracking-tight">{withBot(s.title, bot)}</h3>
              <p className="text-[15px] leading-6 text-ink-soft">{withBot(s.body, bot)}</p>
              {s.aside && (
                <details className="text-[14px] leading-5 text-ink-soft">
                  <summary className="cursor-pointer font-medium text-ink underline decoration-line underline-offset-2">{s.aside.label}</summary>
                  <p className="mt-1.5">{withBot(s.aside.text, bot)}</p>
                </details>
              )}
            </div>
          </div>
          {s.chat.length > 0 && (
            <ul className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line-soft bg-sand p-3 sm:self-start" aria-label="Example chat">
              {s.chat.map((b, j) => (
                <ChatBubble key={j} b={b} bot={bot} />
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}
