/** PLACEHOLDER: the AI agent replaces this (admin answers the titler's question, which re-titles the request). */
export function AiQuestionCard({ question }: { requestId: number; question: string | null; canAnswer: boolean }) {
  if (!question) return null;
  return <div className="rounded-[var(--radius-card)] border border-line-soft p-4">AI asks: {question}</div>;
}
