import { describe, expect, it } from "vitest";
import { dueLabel, formatDateIST, formatDateTimeIST, istDayKey, relativeTime } from "./format";

// 2026-10-14 is a Wednesday. 10:00 IST = 04:30Z
const now = new Date("2026-10-14T04:30:00Z");

describe("relativeTime", () => {
  it("compact ages", () => {
    expect(relativeTime(new Date(now.getTime() - 20_000), now)).toBe("just now");
    expect(relativeTime(new Date(now.getTime() - 5 * 60_000), now)).toBe("5m ago");
    expect(relativeTime(new Date(now.getTime() - 3 * 3600_000), now)).toBe("3h ago");
    expect(relativeTime(new Date(now.getTime() - 2 * 86400_000), now)).toBe("2d ago");
    expect(relativeTime(new Date("2026-09-01T04:30:00Z"), now)).toBe("1 Sept");
  });
});

describe("IST dates", () => {
  it("formats in Asia/Kolkata regardless of host tz", () => {
    // 20:00Z on the 14th is 01:30 IST on the 15th
    expect(istDayKey(new Date("2026-10-14T20:00:00Z"))).toBe("2026-10-15");
    expect(formatDateIST(new Date("2026-10-14T20:00:00Z"))).toBe("Thu 15 Oct");
    expect(formatDateTimeIST(new Date("2026-10-14T13:00:00Z"))).toBe("Wed 14 Oct, 6:30 pm");
  });
});

describe("dueLabel", () => {
  it("today / tomorrow / weekday / date / overdue, by IST calendar day", () => {
    expect(dueLabel(new Date("2026-10-14T15:00:00Z"), now)).toEqual({ text: "due today", overdue: false });
    expect(dueLabel(new Date("2026-10-14T20:00:00Z"), now)).toEqual({ text: "due tomorrow", overdue: false });
    expect(dueLabel(new Date("2026-10-16T06:00:00Z"), now)).toEqual({ text: "due Fri", overdue: false });
    expect(dueLabel(new Date("2026-10-25T06:00:00Z"), now)).toEqual({ text: "due 25 Oct", overdue: false });
    expect(dueLabel(new Date("2026-10-14T03:00:00Z"), now)).toEqual({ text: "overdue", overdue: true });
    expect(dueLabel(new Date("2026-10-12T06:00:00Z"), now)).toEqual({ text: "overdue 2d", overdue: true });
    expect(dueLabel(null, now)).toBeNull();
  });
});
