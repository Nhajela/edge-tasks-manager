import { describe, expect, it } from "vitest";
import type { AuditEntry } from "@/lib/types";
import { describe as line } from "./Timeline";

const ai = (data: Record<string, unknown>, summary = "") => ({ action: "request.ai", summary, data }) as unknown as AuditEntry;

describe("Timeline lines for the AI titler", () => {
  it("says it in plain words, no 'AI skipped/failed'", () => {
    expect(line(ai({ aiStatus: "skipped" }, "AI skipped"))).toBe("kept the original title");
    expect(line(ai({ aiStatus: "failed" }, "AI failed"))).toBe("kept the original title");
    expect(line(ai({ aiStatus: "done" }, "AI done"))).toBe("checked the title");
    expect(line(ai({ aiQuestion: "Which hall?" }, "Asked: Which hall?"))).toBe("asked: Which hall?");
    expect(line(ai({ aiQuestion: null }, "AI updated"))).toBe("got its question answered");
  });
});
