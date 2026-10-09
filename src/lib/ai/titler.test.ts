import { describe, expect, it, vi } from "vitest";
import { buildPrompt, EDGE_CONTEXT } from "./context";
import { generateTitle, istToDate, OUTPUT_SCHEMA } from "./titler";

const now = new Date("2026-10-09T06:30:00Z"); // Fri 9 Oct, 12:00 IST

const input = {
  body: "can you get 20 extension cords for the hackathon tonight?",
  requester: "@asha",
  assignee: "@ben",
  chatTitle: "ECI Ops",
  now,
  items: [
    { kind: "fact" as const, text: "The dome is the main hall", answer: null },
    { kind: "question" as const, text: "Who handles AV?", answer: "Ben" },
  ],
};

function okFetch(out: unknown) {
  return vi.fn<typeof fetch>(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }] }), { status: 200 }),
  );
}

describe("buildPrompt", () => {
  it("carries event context, IST today, a calendar, memory and the request", () => {
    const msgs = buildPrompt(input);
    const all = msgs.map((m) => m.content).join("\n");
    expect(msgs[0].role).toBe("system");
    expect(all).toContain(EDGE_CONTEXT);
    expect(all).toMatch(/Riva Beach Resort/);
    expect(all).toMatch(/Today is Fri 9 Oct 2026, 12:00 IST/);
    expect(all).toMatch(/Sat 10 Oct = 2026-10-10/);
    expect(all).toMatch(/Sun 11 Oct = 2026-10-11/);
    expect(all).toMatch(/tonight.*21:00/i);
    expect(all).toMatch(/morning.*10:00/i);
    expect(all).toMatch(/DD\/MM/);
    expect(all).toContain("Fact: The dome is the main hall");
    expect(all).toContain("Q: Who handles AV? A: Ben");
    expect(all).toContain("@asha");
    expect(all).toContain("@ben");
    expect(all).toContain("ECI Ops");
    expect(all).toContain(input.body);
  });

  it("states the priority rubric", () => {
    const sys = buildPrompt(input)[0].content;
    for (const p of ["urgent", "high", "normal", "low"]) expect(sys).toContain(p);
  });
});

describe("istToDate", () => {
  it.each([
    ["tonight", "2026-10-09T21:00", "2026-10-09T15:30:00.000Z"],
    ["tomorrow morning", "2026-10-10T10:00", "2026-10-10T04:30:00.000Z"],
    ["by Friday (date only = 18:00 IST)", "2026-10-16", "2026-10-16T12:30:00.000Z"],
    ["before the opening on the 11th", "2026-10-11T09:00", "2026-10-11T03:30:00.000Z"],
    ["14/10", "2026-10-14", "2026-10-14T12:30:00.000Z"],
    ["explicit offset kept", "2026-10-14T10:00:00+05:30", "2026-10-14T04:30:00.000Z"],
  ])("%s", (_label, local, iso) => {
    expect(istToDate(local)?.toISOString()).toBe(iso);
  });

  it("null and garbage give null", () => {
    expect(istToDate(null)).toBeNull();
    expect(istToDate("next-ish")).toBeNull();
  });
});

describe("generateTitle", () => {
  const out = { title: "Get 20 extension cords for hackathon", priority: "high", due_at: "2026-10-09T21:00", question: null };

  it("calls OpenRouter with json_schema, the model, the key and a timeout signal", async () => {
    const fetch = okFetch(out);
    const res = await generateTitle(input, { fetch, apiKey: "k", model: "m/x" });
    expect(res).toEqual({ title: out.title, priority: "high", dueAt: new Date("2026-10-09T15:30:00Z"), question: null });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init!.headers as Record<string, string>).authorization).toBe("Bearer k");
    expect(init!.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(init!.body as string);
    expect(body.model).toBe("m/x");
    expect(body.response_format).toEqual({ type: "json_schema", json_schema: { name: "request_title", strict: true, schema: OUTPUT_SCHEMA } });
  });

  it("falls back to json_object when json_schema is rejected", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("response_format not supported", { status: 400 }))
      .mockImplementationOnce(okFetch(out));
    await generateTitle(input, { fetch, apiKey: "k", model: "m/x" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1][1].body).response_format).toEqual({ type: "json_object" });
  });

  it("accepts JSON wrapped in a code fence, trims the title to 60 and blank questions to null", async () => {
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "```json\n" + JSON.stringify({ ...out, title: "x".repeat(80), question: " " }) + "\n```" } }] }),
      ),
    );
    const res = await generateTitle(input, { fetch, apiKey: "k", model: "m" });
    expect(res.title).toHaveLength(60);
    expect(res.question).toBeNull();
  });

  it("throws on invalid output (bad priority) and on HTTP errors", async () => {
    await expect(generateTitle(input, { fetch: okFetch({ ...out, priority: "asap" }), apiKey: "k", model: "m" })).rejects.toThrow();
    const fail = vi.fn(async () => new Response("boom", { status: 500 }));
    await expect(generateTitle(input, { fetch: fail, apiKey: "k", model: "m" })).rejects.toThrow(/500/);
    expect(fail).toHaveBeenCalledTimes(1);
  });
});
