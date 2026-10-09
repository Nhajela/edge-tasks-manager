import type { Priority, Status } from "./types";

export const TZ = "Asia/Kolkata";

// Edge City India: Oct 11 – Nov 1 2026, Riva Beach Resort, Mandrem
export const EVENT = {
  name: "Edge City India",
  start: "2026-10-11",
  end: "2026-11-01",
  venue: "Riva Beach Resort, Mandrem",
};

export const STATUSES: Status[] = ["open", "in_progress", "waiting", "done", "declined"];
/** Finished requests; everything else counts as open in lists. */
export const CLOSED: Status[] = ["done", "declined"];
export const STATUS_LABEL: Record<Status, string> = {
  open: "Open",
  in_progress: "Doing",
  waiting: "Waiting",
  done: "Done",
  declined: "Declined",
};

export const PRIORITIES: Priority[] = ["low", "normal", "high", "urgent"];

export const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME ?? "";
/** Canonical origin for links the bot sends. Falls back to Vercel's production domain, then localhost. */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")
).replace(/\/+$/, "");
