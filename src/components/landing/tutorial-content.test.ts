import { describe, expect, it } from "vitest";
import { COMMAND_ENTRIES, STEPS, WORD_ENTRIES, withBot } from "./tutorial-content";

describe("tutorial content", () => {
  it("replaces the @bot placeholder, leaving @bob alone", () => {
    expect(withBot("@bot @bob fix it, thanks @bot", "edge_tasks_bot")).toBe("@edge_tasks_bot @bob fix it, thanks @edge_tasks_bot");
  });

  it("has unique, non-empty terms and steps", () => {
    const terms = [...COMMAND_ENTRIES, ...WORD_ENTRIES].map((e) => e.term);
    expect(new Set(terms).size).toBe(terms.length);
    for (const e of [...COMMAND_ENTRIES, ...WORD_ENTRIES]) expect(e.meaning.length).toBeGreaterThan(0);
    expect(new Set(STEPS.map((s) => s.title)).size).toBe(STEPS.length);
    for (const s of STEPS) for (const b of s.chat) expect(b.from === "you" || !!b.name).toBe(true);
  });
});
