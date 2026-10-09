"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { COMMAND_ENTRIES, type Entry, WORD_ENTRIES, withBot } from "./tutorial-content";

const matches = (e: Entry, q: string, bot: string) =>
  withBot([e.term, e.meaning, e.example ?? ""].join(" "), bot).toLowerCase().includes(q);

function Group({ title, entries, bot }: { title: string; entries: Entry[]; bot: string }) {
  if (!entries.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink-mute">{title}</h3>
      <dl className="divide-y divide-line-soft rounded-[var(--radius-card)] border border-line-soft bg-paper">
        {entries.map((e) => (
          <div key={e.term} className="grid gap-1 px-4 py-3 sm:grid-cols-[14rem_1fr] sm:gap-4">
            <dt className="font-mono text-[14px] font-semibold leading-5 break-words">{withBot(e.term, bot)}</dt>
            <dd className="flex flex-col gap-1 text-[14.5px] leading-6 text-ink-soft">
              <span>{withBot(e.meaning, bot)}</span>
              {e.example && (
                <code className="self-start rounded-md bg-sand px-2 py-0.5 font-mono text-[13px] leading-5 text-ink break-all">
                  {withBot(e.example, bot)}
                </code>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** "Every command and word": a searchable glossary. */
export function Glossary({ bot }: { bot: string }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filter = (list: Entry[]) => (q ? list.filter((e) => matches(e, q, bot)) : list);
  const commands = filter(COMMAND_ENTRIES);
  const words = filter(WORD_ENTRIES);
  return (
    <div className="flex flex-col gap-5">
      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search, e.g. append or waiting"
        aria-label="Search commands and words"
        className="max-w-md"
      />
      <Group title="Commands" entries={commands} bot={bot} />
      <Group title="Words" entries={words} bot={bot} />
      {!commands.length && !words.length && <p className="text-[14.5px] text-ink-mute">Nothing matches “{query}”.</p>}
    </div>
  );
}
