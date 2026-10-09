import { describe, expect, it } from "vitest";
import type { Request } from "@/lib/types";
import { grouped, type Block } from "../replies";

const req = (id: number) => ({ id, title: `T${id}`, status: "open", customStatus: null, dueAt: null }) as unknown as Request;
const block = (heading: string, n: number, from = 0): Block => {
  const items = Array.from({ length: n }, (_, i) => req(from + i + 1));
  return { heading, total: n, sections: [{ title: "Act", count: n, items }] };
};

describe("grouped", () => {
  it("shares the line budget so a full first block never hides the second", () => {
    const out = grouped([block("@bob asked you", 12), block("You asked @bob", 3, 100)], new Date(), "none", 10);
    expect(out).toContain("You asked @bob");
    expect(out).toContain("#103");
    expect((out.match(/^#\d+/gm) ?? []).length).toBe(10);
    expect(out).toContain("…and 5 more on the dashboard");
  });

  it("a short first block leaves its lines to the second", () => {
    const out = grouped([block("A", 2), block("B", 12, 100)], new Date(), "none", 10);
    expect((out.match(/^#1\d\d/gm) ?? []).length).toBe(8);
  });
});
