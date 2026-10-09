import Link from "next/link";
import type { ReactNode } from "react";
import { Column, Mark } from "@/components/bits";
import { Nav, TabBar } from "@/components/Nav";
import { navItems } from "@/components/navItems";
import { ThemeToggle } from "@/components/ThemeToggle";

/**
 * Logged-in frame: a floating glass header pill (nav inline on desktop) and, on phones, a bottom tab bar.
 * The footer (event line, feedback) lives in the root layout so it also appears on error and not-found pages.
 */
export function Shell({ isAdmin, inboxCount = 0, children }: { isAdmin?: boolean; inboxCount?: number; children: ReactNode }) {
  const items = navItems(!!isAdmin);
  return (
    <>
      <header className="sticky top-0 z-30 pt-[calc(env(safe-area-inset-top)+10px)]">
        <Column className="max-w-3xl">
          <div className="flex h-13 items-center justify-between gap-3 rounded-full border border-line bg-paper/80 py-1.5 pl-3 pr-1.5 shadow-[0_10px_30px_-14px_rgba(20,27,52,0.35)] backdrop-blur-md">
            <Link href="/inbox" className="flex min-w-0 items-center gap-2 rounded-full py-1 pr-2">
              <Mark />
              <span className="truncate text-[15.5px] font-semibold tracking-tight">Edge Tasks</span>
            </Link>
            <div className="flex items-center gap-1">
              <Nav items={items} inboxCount={inboxCount} />
              <ThemeToggle />
            </div>
          </div>
        </Column>
      </header>
      <main className="flex-1 pb-16 pt-6 sm:pt-8">
        <Column className="max-w-3xl">{children}</Column>
      </main>
      <TabBar items={items} inboxCount={inboxCount} />
    </>
  );
}
