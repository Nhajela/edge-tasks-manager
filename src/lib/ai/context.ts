/** The titler's prompt: fixed Edge City India context + the admin-curated memory (ai_context) + the request. */
import { EVENT, TZ } from "@/lib/constants";
import { istDayKey } from "@/lib/format";
import type { AiContextItem } from "@/lib/types";

export const EDGE_CONTEXT = `${EVENT.name} is a popup village (a few hundred builders, researchers and creators living and working together) from Sun 11 Oct to Sun 1 Nov 2026 at ${EVENT.venue}, North Goa. The opening day is 11 Oct. People raise requests to each other in Telegram groups: venue and AV setup (projectors, mics, extension cords, wifi), rooms and housing, food and dietary needs, transport (airport pickups from GOX/GOI, scooters, taxis), events and talks, payments and reimbursements, supplies bought from Mapusa or Panjim, health and safety.`;

export type PromptInput = {
  body: string;
  requester: string;
  assignee: string;
  chatTitle?: string | null;
  now: Date;
  items: Pick<AiContextItem, "kind" | "text" | "answer">[];
};

export type ChatMessage = { role: "system" | "user"; content: string };

const ist = (d: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...o }).format(d);
const dayLabel = (d: Date) => ist(d, { weekday: "short", day: "numeric", month: "short" }).replace(",", "");

const RULES = `Reply with JSON only: {"title": string, "priority": "low"|"normal"|"high"|"urgent", "due_at": string|null, "question": string|null}.
- title: at most 60 characters, imperative and specific (verb first, the thing, the place or event if known). No "#", no @names, no trailing period. Example: "Buy 20 extension cords for the hackathon".
- priority rubric: urgent = safety, health, someone stranded, or blocking something happening within a few hours; high = needed today or tomorrow, or blocks an event or many people; normal = the default for ordinary asks; low = nice to have, no deadline.
- due_at: when it must be done, as IST local time "YYYY-MM-DDTHH:mm" (or "YYYY-MM-DD" when only the day is known), or null when no deadline is stated or implied. Use the calendar below, never guess a weekday. Conventions: tonight = 21:00 today; this morning / tomorrow morning = 10:00; afternoon = 15:00; evening = 18:00; "by <day>" = that day; a weekday means its next occurrence (today counts only if it says "today"); "the 11th" = the next 11th; numeric dates are DD/MM (14/10 = 14 Oct); "before the opening" = before ${EVENT.start} 09:00.
- question: null, or ONE short question to the organisers whose answer would help you title or understand requests like this better (unknown place names, people, acronyms). Never ask what the request already says.`;

export function buildPrompt(input: PromptInput): ChatMessage[] {
  const { now } = input;
  const calendar = Array.from({ length: 24 }, (_, i) => {
    const d = new Date(now.getTime() + i * 86400_000);
    return `${dayLabel(d)} = ${istDayKey(d)}${i === 0 ? " (today)" : i === 1 ? " (tomorrow)" : ""}`;
  }).join("\n");
  const memory = input.items
    .map((i) => (i.kind === "fact" ? `Fact: ${i.text}` : `Q: ${i.text} A: ${i.answer ?? ""}`))
    .join("\n");

  const system = [
    "You title task requests for a community event's organiser dashboard.",
    EDGE_CONTEXT,
    memory && `What the organisers told you:\n${memory}`,
    `Today is ${dayLabel(now)} ${ist(now, { year: "numeric" })}, ${ist(now, { hour: "2-digit", minute: "2-digit", hour12: false })} IST.\nCalendar:\n${calendar}`,
    RULES,
  ]
    .filter(Boolean)
    .join("\n\n");

  const user = [
    `From: ${input.requester}`,
    `To: ${input.assignee}`,
    input.chatTitle && `Telegram group: ${input.chatTitle}`,
    `Request:\n${input.body}`,
  ]
    .filter(Boolean)
    .join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
