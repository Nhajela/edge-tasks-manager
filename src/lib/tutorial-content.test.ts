import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMMAND_ENTRIES, STEPS, WORD_ENTRIES, commandsMarkdown, helpLines, withBot } from "./tutorial-content";

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

  it("/help lists every entry that has a help line, with the bot name filled in", () => {
    const text = helpLines("etmbot").join("\n");
    for (const e of COMMAND_ENTRIES.filter((x) => x.help)) expect(text).toContain(withBot(e.term, "etmbot"));
    expect(text).toContain("@etmbot @bob <what>");
    expect(text).not.toContain("@bot ");
  });

  it("README's Bot commands table is generated from this file (run: node scripts/readme-commands.mjs)", () => {
    const readme = readFileSync("README.md", "utf8").replace(/\r\n/g, "\n");
    const block = /<!-- commands:start -->\n([\s\S]*?)\n<!-- commands:end -->/.exec(readme)?.[1];
    expect(block).toBe(commandsMarkdown("EdgeTasksBot"));
  });
});
