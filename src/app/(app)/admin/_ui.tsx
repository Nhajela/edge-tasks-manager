import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { requireViewer } from "@/lib/viewer";
import { cn } from "@/lib/utils";

/** Admin pages 404 for everyone else (no hint that the page exists). */
export async function requireAdminViewer(path: string) {
  const v = await requireViewer(path);
  if (!v.actor.isAdmin) notFound();
  return v;
}

/** One searchParam as a string ("" when missing or repeated). */
export const param = (sp: Record<string, string | string[] | undefined>, k: string) => {
  const v = sp[k];
  return typeof v === "string" ? v : "";
};

/** Integer (chat ids are negative) or undefined. */
export const intParam = (s: string) => (/^-?\d+$/.test(s) ? Number(s) : undefined);

/** href with the given params, dropping empty ones. */
export function hrefWith(path: string, params: Record<string, string | number | undefined | null>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

export function AdminHeader({ current, children }: { current: "requests" | "activity"; children?: ReactNode }) {
  const tab = (href: string, label: string, key: typeof current) => (
    <Link
      href={href}
      aria-current={current === key ? "page" : undefined}
      className={cn(
        "pill inline-flex min-h-10 items-center px-3.5 text-[15px] font-medium",
        current === key ? "bg-ink text-paper" : "bg-sand text-ink-soft hover:text-ink",
      )}
    >
      {label}
    </Link>
  );
  return (
    <header className="mb-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h1 className="display text-[28px] font-bold">Admin</h1>
        <nav className="flex gap-1.5" aria-label="Admin">
          {tab("/admin", "Requests", "requests")}
          {tab("/admin/activity", "Activity", "activity")}
        </nav>
      </div>
      {children}
    </header>
  );
}

/** Native select: best on phones, works without JS. */
export function Select({ label, name, value, children }: { label: string; name: string; value: string; children: ReactNode }) {
  return (
    <label className="flex min-w-[9rem] flex-1 flex-col gap-1 text-[13px] font-medium text-ink-soft">
      {label}
      <select
        name={name}
        defaultValue={value}
        className="h-11 w-full min-w-0 rounded-(--radius-field) border border-input bg-background px-3 text-[15px] text-ink"
      >
        {children}
      </select>
    </label>
  );
}

export function Chip({ href, active, children }: { href: string; active?: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "pill inline-flex min-h-9 shrink-0 items-center gap-1.5 border px-3 text-[14px] font-medium",
        active ? "border-ink bg-ink text-paper" : "border-line-soft bg-card text-ink-soft hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}
