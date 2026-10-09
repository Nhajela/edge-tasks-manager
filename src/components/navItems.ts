export type NavIcon = "inbox" | "raised" | "all" | "activity" | "context" | "settings";
export type NavItem = { href: string; label: string; icon: NavIcon; badge?: "inbox" };

const MAIN: NavItem[] = [
  { href: "/inbox", label: "To me", icon: "inbox", badge: "inbox" },
  { href: "/raised", label: "I asked", icon: "raised" },
];
const ADMIN: NavItem[] = [
  { href: "/admin", label: "All", icon: "all" },
  { href: "/admin/activity", label: "Activity", icon: "activity" },
  { href: "/context", label: "Context", icon: "context" },
];
const SETTINGS: NavItem = { href: "/settings", label: "Settings", icon: "settings" };

export const navItems = (isAdmin: boolean): NavItem[] => [...MAIN, ...(isAdmin ? ADMIN : []), SETTINGS];

/** The nav item a path belongs to: the longest href that is the path or a parent segment of it. */
export function activeHref(items: NavItem[], path: string): string | null {
  const p = path.split(/[?#]/)[0];
  let best: string | null = null;
  for (const { href } of items)
    if ((p === href || p.startsWith(href + "/")) && href.length > (best?.length ?? 0)) best = href;
  return best;
}
