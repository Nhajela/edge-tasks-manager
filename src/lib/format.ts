/** Display helpers. All calendar maths is in IST (Asia/Kolkata), whatever the server/browser timezone. */
import { TZ } from "./constants";

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...opts });
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const weekdayFmt = fmt({ weekday: "short" });
const dayMonthFmt = fmt({ day: "numeric", month: "short" });
const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });

/** "2026-10-15": the IST calendar day. */
export const istDayKey = (d: Date) => dayKeyFmt.format(d);

/** Whole IST calendar days from `now` to `d` (negative = past). */
function dayDiff(d: Date, now: Date) {
  return Math.round((Date.parse(istDayKey(d)) - Date.parse(istDayKey(now))) / 86400_000);
}

/** "Thu 15 Oct" */
export const formatDateIST = (d: Date) => `${weekdayFmt.format(d)} ${dayMonthFmt.format(d)}`;

/** "Wed 14 Oct, 6:30 pm" */
export const formatDateTimeIST = (d: Date) => `${formatDateIST(d)}, ${timeFmt.format(d).toLowerCase()}`;

/** "just now", "5m ago", "3h ago", "2d ago", then "1 Sep". */
export function relativeTime(d: Date, now: Date = new Date()): string {
  const s = Math.max(0, (now.getTime() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return dayMonthFmt.format(d);
}

/** "due today" / "due tomorrow" / "due Fri" (within a week) / "due 25 Oct"; past → "overdue" / "overdue 2d". */
export function dueLabel(due: Date | null | undefined, now: Date = new Date()): { text: string; overdue: boolean } | null {
  if (!due) return null;
  if (due.getTime() < now.getTime()) {
    const days = -dayDiff(due, now);
    return { text: days > 0 ? `overdue ${days}d` : "overdue", overdue: true };
  }
  const days = dayDiff(due, now);
  const text = days === 0 ? "today" : days === 1 ? "tomorrow" : days < 7 ? weekdayFmt.format(due) : dayMonthFmt.format(due);
  return { text: `due ${text}`, overdue: false };
}
