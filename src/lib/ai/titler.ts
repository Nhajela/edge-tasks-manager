/** OpenRouter call + output validation for the titler. No DB here: src/services/titler.ts does the writes. */
import { z } from "zod";
import type { Priority } from "@/lib/types";
import { buildPrompt, type PromptInput } from "./context";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_MODEL = "google/gemini-2.5-flash";
const TIMEOUT_MS = 20_000;
const TITLE_MAX = 60;

export const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "≤60 chars, imperative, specific" },
    priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
    due_at: { type: ["string", "null"], description: "IST local YYYY-MM-DDTHH:mm or YYYY-MM-DD, or null" },
    question: { type: ["string", "null"] },
  },
  required: ["title", "priority", "due_at", "question"],
  additionalProperties: false,
} as const;

const blankToNull = (s: string | null | undefined) => (s?.trim() ? s.trim() : null);

const Output = z.object({
  title: z
    .string()
    .transform((s) => s.trim().replace(/\.$/, "").slice(0, TITLE_MAX).trimEnd())
    .pipe(z.string().min(1)),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  due_at: z.string().nullish().transform(blankToNull),
  question: z.string().nullish().transform(blankToNull),
});

export type TitleResult = { title: string; priority: Priority; dueAt: Date | null; question: string | null };

/** "2026-10-09T21:00" (IST wall time) → Date. A date alone means 18:00 IST. An explicit Z/offset is kept. */
export function istToDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const v = s.trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(v)
    ? `${v}T18:00:00+05:30`
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(v)
      ? `${v}+05:30`
      : /^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(v)
        ? v
        : null;
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type GenerateDeps = { fetch?: typeof fetch; apiKey: string; model: string };

type Format = { type: "json_schema"; json_schema: object } | { type: "json_object" };

export async function generateTitle(input: PromptInput, deps: GenerateDeps): Promise<TitleResult> {
  const doFetch = deps.fetch ?? fetch;
  const messages = buildPrompt(input);
  const call = (response_format: Format) =>
    doFetch(OPENROUTER_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${deps.apiKey}`, "content-type": "application/json", "x-title": "Edge Tasks Manager" },
      body: JSON.stringify({ model: deps.model, messages, response_format, temperature: 0.2 }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  let res = await call({ type: "json_schema", json_schema: { name: "request_title", strict: true, schema: OUTPUT_SCHEMA } });
  // some models/providers reject structured outputs: retry once with plain JSON mode
  if (res.status === 400) res = await call({ type: "json_object" });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content ?? "";
  const raw = content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "");
  const out = Output.parse(JSON.parse(raw));
  return { title: out.title, priority: out.priority, dueAt: istToDate(out.due_at), question: out.question };
}
