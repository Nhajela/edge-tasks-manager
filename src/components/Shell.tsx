import Link from "next/link";
import type { ReactNode } from "react";
import type { Session } from "@/lib/types";
import { Column, Mark } from "@/components/bits";
import { cn } from "@/lib/utils";
import { LinkHint } from "@/components/feedback";

/**
 * Header + main column. The footer (event line, feedback) lives in the root layout
 * so it also appears on error and not-found pages.
 */
export function Shell({
  session,
  isAdmin,
  current,
  wide,
  hero,
  children,
}: {
  session: Session | null;
  isAdmin?: boolean;
  current?: "home" | "inbox" | "raised" | "settings" | "context" | "admin";
  wide?: boolean;
  /** Full-bleed hero rendered above the column; replaces the sticky header (the hero carries the nav). */
  hero?: ReactNode;
  children: ReactNode;
}) {
  const navLink = (href: string, label: string, key: typeof current) => (
    <Link
      href={href}
      aria-current={current === key ? "page" : undefined}
      className={cn(
        "pill inline-flex min-h-9 items-center px-2.5 py-1.5 text-[14px] font-medium transition-colors sm:px-3",
        current === key ? "bg-sand text-ink" : "text-ink-soft hover:bg-sand hover:text-ink",
      )}
    >
      {label}
      <LinkHint />
    </Link>
  );

  if (hero) {
    return (
      <main className="flex-1 pb-16 pt-6 sm:pt-10">
        {hero}
        <Column wide={wide}>{children}</Column>
      </main>
    );
  }

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line-soft bg-paper/85 backdrop-blur supports-backdrop-filter:bg-paper/75">
        <Column wide={wide} className="flex h-14 items-center justify-between gap-3">
          <Link href="/" className="flex min-w-0 items-center gap-2 pill py-1 pr-2">
            <Mark />
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-[15px] font-semibold tracking-tight sm:text-[16px]">
                Edge Tasks
              </span>
            </span>
          </Link>
          <nav className="flex shrink-0 items-center gap-0.5" aria-label="Main">
            {session ? (
              <>
                {navLink("/inbox", "To me", "inbox")}
                {navLink("/raised", "I asked", "raised")}
                {navLink("/settings", "Settings", "settings")}
                {isAdmin && navLink("/admin", "Admin", "admin")}
              </>
            ) : (
              <a
                href="https://edgecity.live/india26"
                target="_blank"
                rel="noreferrer"
                className="pill px-3 py-1.5 text-[14px] font-medium text-ink-soft hover:bg-sand hover:text-ink"
              >
                Edge City India
              </a>
            )}
          </nav>
        </Column>
      </header>
      <main className="flex-1 pb-16 pt-6 sm:pt-10">
        <Column wide={wide}>{children}</Column>
      </main>
    </>
  );
}
