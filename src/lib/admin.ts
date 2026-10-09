export const normalizeUsername = (u: string) => u.trim().replace(/^@/, "").toLowerCase();

/** The superadmin is SUPERADMIN_USERNAME (env), pinned to SUPERADMIN_TELEGRAM_ID when set. */
export function superadminUsername() {
  return normalizeUsername(process.env.SUPERADMIN_USERNAME ?? "");
}

export function superadminTelegramId() {
  return process.env.SUPERADMIN_TELEGRAM_ID?.trim() || null;
}

/** Works for a Session or a people row. */
export function isSuperadmin(who: { telegramId: string | number | null; username: string | null } | null): boolean {
  if (!who) return false;
  // usernames can be released and re-claimed by someone else; the numeric id can't
  const id = superadminTelegramId();
  if (id) return who.telegramId != null && String(who.telegramId) === id;
  const su = superadminUsername();
  return Boolean(su && who.username && normalizeUsername(who.username) === su);
}

// ponytail: superadmin is the only admin; add an admins table (see eci-travel-coop) if more are needed
export const isAdmin = isSuperadmin;
