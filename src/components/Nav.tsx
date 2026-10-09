"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Brain, Inbox, LayoutList, Send, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { activeHref, type NavIcon, type NavItem } from "./navItems";

const ICONS: Record<NavIcon, typeof Inbox> = {
  inbox: Inbox,
  raised: Send,
  all: LayoutList,
  activity: Activity,
  context: Brain,
  settings: Settings,
};

function Badge({ n, className }: { n: number; className?: string }) {
  if (!n) return null;
  return (
    <span
      aria-label={`${n} open`}
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-marigold px-1 text-[11px] font-semibold leading-none text-[#141b34] tnum",
        className,
      )}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

type Props = { items: NavItem[]; inboxCount: number };
const count = (i: NavItem, inboxCount: number) => (i.badge === "inbox" ? inboxCount : 0);

/** Desktop: text links inside the header pill. */
export function Nav({ items, inboxCount }: Props) {
  const active = activeHref(items, usePathname());
  return (
    <nav aria-label="Main" className="hidden items-center gap-0.5 sm:flex">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={active === i.href ? "page" : undefined}
          className={cn(
            "inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] font-medium transition-colors",
            active === i.href ? "bg-ink text-paper" : "text-ink-soft hover:bg-sand hover:text-ink",
          )}
        >
          {i.label}
          <Badge n={count(i, inboxCount)} />
        </Link>
      ))}
    </nav>
  );
}

/**
 * Phones: an icon tab bar floating at the bottom, in thumb reach. Must render outside the header pill:
 * its backdrop-filter would become the containing block for this fixed element.
 */
export function TabBar({ items, inboxCount }: Props) {
  const active = activeHref(items, usePathname());
  return (
    <nav
      aria-label="Main"
      data-tabbar
      className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+10px)] z-40 flex justify-between rounded-[22px] border border-line bg-paper/85 p-1 shadow-[0_10px_30px_-12px_rgba(20,27,52,0.45)] backdrop-blur-md sm:hidden"
    >
      {items.map((i) => {
        const Icon = ICONS[i.icon];
        const on = active === i.href;
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={on ? "page" : undefined}
            className={cn(
              "relative flex min-h-13 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[18px] text-[11.5px] font-medium",
              on ? "bg-ink text-paper" : "text-ink-soft active:bg-sand",
            )}
          >
            <Icon className="size-5" aria-hidden />
            <span className="truncate">{i.label}</span>
            <Badge n={count(i, inboxCount)} className="absolute right-[calc(50%-22px)] top-1" />
          </Link>
        );
      })}
    </nav>
  );
}
