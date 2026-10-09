import { describe, expect, it } from "vitest";
import type { ListItem } from "@/services/requests";
import { parseTile, tileMatches } from "./StatTiles";

const now = new Date("2026-10-14T04:30:00Z");
const day = 86400_000;
const row = (p: Partial<ListItem>) => ({ status: "open", dueAt: null, doneAt: null, ...p }) as ListItem;

describe("tileMatches", () => {
  it("overdue: still open and past due", () => {
    expect(tileMatches("overdue", row({ dueAt: new Date(+now - day) }), now)).toBe(true);
    expect(tileMatches("overdue", row({ status: "in_progress", dueAt: new Date(+now - 1000) }), now)).toBe(true);
    expect(tileMatches("overdue", row({ dueAt: new Date(+now + day) }), now)).toBe(false);
    expect(tileMatches("overdue", row({ status: "done", dueAt: new Date(+now - day) }), now)).toBe(false);
    expect(tileMatches("overdue", row({}), now)).toBe(false);
  });
  it("open / in progress / waiting follow the status", () => {
    expect(tileMatches("open", row({}), now)).toBe(true);
    expect(tileMatches("open", row({ status: "waiting" }), now)).toBe(false);
    expect(tileMatches("in_progress", row({ status: "in_progress" }), now)).toBe(true);
    expect(tileMatches("waiting", row({ status: "waiting" }), now)).toBe(true);
  });
  it("done this week: done in the last 7 days", () => {
    expect(tileMatches("done_this_week", row({ status: "done", doneAt: new Date(+now - 2 * day) }), now)).toBe(true);
    expect(tileMatches("done_this_week", row({ status: "done", doneAt: new Date(+now - 8 * day) }), now)).toBe(false);
    expect(tileMatches("done_this_week", row({ status: "declined", doneAt: new Date(+now - day) }), now)).toBe(false);
  });
});

describe("parseTile", () => {
  it("accepts tile keys only", () => {
    expect(parseTile("overdue")).toBe("overdue");
    expect(parseTile("nope")).toBeNull();
    expect(parseTile(["waiting"])).toBeNull();
    expect(parseTile(undefined)).toBeNull();
  });
});
