"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { ActionForm } from "@/app/(app)/context/ActionForm";
import { answerAction } from "@/app/(app)/context/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** The titler's open question on /r/[id]. Admins answer inline: it goes to the titler's memory and re-titles. */
export function AiQuestionCard({ requestId, question, canAnswer }: { requestId: number; question: string | null; canAnswer: boolean }) {
  if (!question) return null;
  return (
    <section aria-label="Question from the AI" className="rounded-[var(--radius-card)] bg-marigold-tint p-4">
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink-soft">
        <Sparkles className="size-3.5" aria-hidden /> The AI titler asks
      </p>
      <p className="mt-1 text-[16px] font-medium leading-6">{question}</p>
      {canAnswer ? (
        <ActionForm action={answerAction} className="mt-3 flex flex-col gap-2">
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="question" value={question} />
          <input type="hidden" name="retitle" value="on" />
          <Textarea name="answer" required maxLength={4000} placeholder="Your answer (it helps title future requests too)" aria-label="Answer" className="bg-card" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="submit">Answer and re-title</Button>
            <Link href="/context" className="text-[13.5px] text-ink-soft underline underline-offset-2">
              All AI questions
            </Link>
          </div>
        </ActionForm>
      ) : (
        <p className="mt-1 text-[13.5px] text-ink-soft">An organiser will answer this.</p>
      )}
    </section>
  );
}
