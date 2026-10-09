import Link from "next/link";
import { Note, SectionTitle } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { db } from "@/db";
import { relativeTime } from "@/lib/format";
import { requireViewer } from "@/lib/viewer";
import * as aiContext from "@/services/aiContext";
import * as requests from "@/services/requests";
import { ActionForm } from "./ActionForm";
import { addFactAction, answerAction, dismissAction, removeAction, retitleRecentAction } from "./actions";
import { FactRow } from "./FactRow";

export const metadata = { title: "Titler memory" };

const card = "rounded-[var(--radius-card)] bg-card ring-1 ring-foreground/8";

/** Admin: what the AI titler knows. Facts and answered questions go into every titling prompt. */
export default async function ContextPage() {
  const { actor } = await requireViewer("/context");
  if (!actor.isAdmin)
    return (
      <section className="flex flex-col gap-3">
        <h1 className="display text-[28px] font-bold">Titler memory</h1>
        <Note>Only organisers can see this page.</Note>
      </section>
    );

  const items = await aiContext.list(db(), actor);
  const open = items.filter((i) => i.kind === "question" && i.status === "open").reverse();
  const facts = items.filter((i) => i.kind === "fact");
  const answered = items.filter((i) => i.kind === "question" && i.status === "answered").reverse();
  const reqIds = [...new Set(open.map((q) => q.requestId).filter((id): id is number => id != null))];
  const titles = new Map(
    await Promise.all(reqIds.map(async (id) => [id, (await requests.getById(db(), actor, id)).title] as const)),
  );

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="display text-[28px] font-bold">Titler memory</h1>
        <p className="mt-1 text-ink-soft">
          What the AI knows when it titles requests. Facts and answered questions go into every prompt.
        </p>
      </header>

      <section>
        <SectionTitle aside={open.length ? `${open.length} open` : undefined}>Questions from the AI</SectionTitle>
        {open.length === 0 ? (
          <Note>No open questions. When the AI is unsure about a request, its question shows up here.</Note>
        ) : (
          <ul className="flex flex-col gap-3">
            {open.map((q) => (
              <li key={q.id} className={`${card} p-4`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[16px] font-medium leading-6">{q.text}</p>
                    <p className="mt-0.5 text-[13.5px] text-ink-mute">
                      {q.requestId != null ? (
                        <Link href={`/r/${q.requestId}`} className="text-ink-soft underline underline-offset-2">
                          #{q.requestId} {titles.get(q.requestId)}
                        </Link>
                      ) : (
                        "General question"
                      )}
                      {" · "}
                      {relativeTime(q.createdAt)}
                    </p>
                  </div>
                  <ActionForm action={dismissAction}>
                    <input type="hidden" name="id" value={q.id} />
                    <Button type="submit" variant="ghost" size="sm" className="text-ink-soft">
                      Dismiss
                    </Button>
                  </ActionForm>
                </div>
                <ActionForm action={answerAction} className="mt-3 flex flex-col gap-2">
                  <input type="hidden" name="questionId" value={q.id} />
                  <Textarea name="answer" required maxLength={4000} placeholder="Answer" aria-label={`Answer: ${q.text}`} />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {q.requestId != null ? (
                      <label className="flex items-center gap-2 text-[14px] text-ink-soft">
                        <input type="checkbox" name="retitle" value="on" defaultChecked className="size-4 accent-[var(--teal)]" />
                        Re-title #{q.requestId}
                      </label>
                    ) : (
                      <span />
                    )}
                    <Button type="submit">Answer</Button>
                  </div>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionTitle aside={facts.length || undefined}>Facts</SectionTitle>
        <div className={`${card} px-4`}>
          <ActionForm action={addFactAction} className="flex flex-col gap-2 py-4">
            <Textarea
              name="text"
              required
              maxLength={4000}
              aria-label="New fact"
              placeholder="e.g. “The dome” is the main hall at Riva. Cabs go through Arjun."
            />
            <Button type="submit" className="self-end">
              Add fact
            </Button>
          </ActionForm>
          {facts.length > 0 && (
            <ul className="divide-y divide-line-soft border-t border-line-soft">
              {facts.map((f) => (
                <FactRow key={f.id} id={f.id} text={f.text} />
              ))}
            </ul>
          )}
        </div>
      </section>

      {answered.length > 0 && (
        <section>
          <SectionTitle aside={answered.length}>Answered</SectionTitle>
          <ul className={`${card} divide-y divide-line-soft px-4`}>
            {answered.map((q) => (
              <li key={q.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0 text-[15px] leading-6">
                  <p className="text-ink-soft">{q.text}</p>
                  <p className="whitespace-pre-wrap break-words">{q.answer}</p>
                </div>
                <ActionForm action={removeAction}>
                  <input type="hidden" name="id" value={q.id} />
                  <Button type="submit" variant="ghost" size="sm" className="text-ink-soft">
                    Forget
                  </Button>
                </ActionForm>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={`${card} flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between`}>
        <div>
          <h2 className="font-semibold">Re-title recent 20</h2>
          <p className="text-[14px] text-ink-soft">Run the AI again on the 20 newest requests. Titles people edited stay.</p>
        </div>
        <ActionForm action={retitleRecentAction}>
          <Button type="submit" variant="outline" className="w-full sm:w-auto">
            Re-title recent 20
          </Button>
        </ActionForm>
      </section>
    </div>
  );
}
