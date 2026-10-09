import { createClaimedCode } from "./login";
import { siteUrl } from "./telegram";

/** How long a login link inside a bot message works (people tap alerts hours later). */
const APP_LINK_TTL_MIN = 3 * 24 * 60;

/** Only same-site paths ("/inbox", "/r/12"), never "//evil.com" or absolute URLs. */
export function safeNext(next: string | null | undefined): string {
  // browsers drop tabs/newlines while parsing, so "/\t/evil.com" would become "//evil.com"
  return next && next.startsWith("/") && !next.startsWith("//") && !/[\\\x00-\x1f\x7f]/.test(next) ? next : "/";
}

/**
 * A personal, single-use link for buttons in bot messages: it logs the person in (after a "Continue as …"
 * confirm) and lands them on `next`. Works even in Telegram's in-app browser, which has no session.
 */
export async function appLink(
  t: { telegramId: string; username: string | null; name?: string; firstName?: string },
  next = "/",
) {
  const firstName = t.firstName ?? (t.name ?? "").split(/\s+/)[0] ?? "";
  const code = await createClaimedCode({ telegramId: t.telegramId, username: t.username, firstName }, APP_LINK_TTL_MIN);
  return siteUrl(`/login?code=${code}&next=${encodeURIComponent(safeNext(next))}`);
}
