import { describe, expect, it } from "vitest";
import { relativeDue } from "./RequestRow";

// 2026-10-14 10:00 IST
const now = new Date("2026-10-14T04:30:00Z");
const ist = (s: string) => new Date(`${s}+05:30`);

describe("relativeDue (IST days)", () => {
  it("says how overdue, in days", () => {
    expect(relativeDue(ist("2026-10-12T18:00"), now)).toEqual({ text: "2 days overdue", overdue: true });
    expect(relativeDue(ist("2026-10-13T23:59"), now)).toEqual({ text: "1 day overdue", overdue: true });
    expect(relativeDue(ist("2026-10-14T08:00"), now)).toEqual({ text: "Overdue", overdue: true });
  });
  it("today, tomorrow, in N days, then the date", () => {
    expect(relativeDue(ist("2026-10-14T23:00"), now)?.text).toBe("Due today");
    expect(relativeDue(ist("2026-10-15T00:30"), now)?.text).toBe("Due tomorrow");
    expect(relativeDue(ist("2026-10-17T09:00"), now)?.text).toBe("Due in 3 days");
    expect(relativeDue(ist("2026-10-21T09:00"), now)?.text).toBe("Due 21 Oct");
  });
  it("nothing without a due date", () => {
    expect(relativeDue(null, now)).toBeNull();
  });
});
