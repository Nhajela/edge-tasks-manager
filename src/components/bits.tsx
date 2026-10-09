import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Sun over two waves: the app mark. */
export function Mark({ className, size = 22 }: { className?: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      className={className}
      aria-hidden
    >
      <circle cx="12" cy="9" r="4.5" fill="var(--marigold)" />
      <path
        d="M2 15.5c2 0 2-1.4 4-1.4s2 1.4 4 1.4 2-1.4 4-1.4 2 1.4 4 1.4 2-1.4 4-1.4"
        stroke="var(--teal)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M4 20c2 0 2-1.4 4-1.4s2 1.4 4 1.4 2-1.4 4-1.4 2 1.4 4 1.4"
        stroke="var(--teal)"
        strokeWidth="1.8"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  );
}

export function Tag({
  tone = "neutral",
  icon,
  children,
  className,
  title,
}: {
  tone?: "neutral" | "teal" | "marigold" | "blue" | "danger";
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  const tones = {
    neutral: "bg-sand text-ink-soft",
    teal: "bg-teal-tint text-teal-deep",
    marigold: "bg-marigold-tint text-ink",
    blue: "bg-blue-tint text-blue-deep",
    danger: "bg-danger-tint text-danger",
  };
  return (
    <span
      title={title}
      className={cn(
        "pill inline-flex max-w-full items-center gap-1 px-2 py-0.5 text-[12.5px] leading-5 [&>svg]:size-3.5 [&>svg]:shrink-0",
        tones[tone],
        className,
      )}
    >
      {icon}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

export function SectionTitle({
  children,
  aside,
  className,
}: {
  children: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex items-baseline justify-between gap-3", className)}>
      <h2 className="text-[20px] font-semibold tracking-tight">{children}</h2>
      {aside && <div className="shrink-0 text-[13.5px] text-ink-mute">{aside}</div>}
    </div>
  );
}

export function Note({
  children,
  tone = "neutral",
  className,
  role,
}: {
  children: ReactNode;
  tone?: "neutral" | "marigold" | "teal" | "danger";
  className?: string;
  role?: string;
}) {
  const tones = {
    neutral: "bg-sand text-ink-soft",
    marigold: "bg-marigold-tint text-ink",
    teal: "bg-teal-tint text-teal-deep",
    danger: "bg-danger-tint text-danger",
  };
  return (
    <div role={role} className={cn("rounded-xl px-3.5 py-2.5 text-[14px] leading-5", tones[tone], className)}>
      {children}
    </div>
  );
}

/** A round initial, for people without a photo (everyone — we don't fetch photos). */
export function Initial({ name, className, you }: { name: string; className?: string; you?: boolean }) {
  const letter = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold",
        you ? "bg-marigold text-[#141b34]" : "bg-sand text-ink-soft",
        className,
      )}
    >
      {letter}
    </span>
  );
}

/** Vertical rhythm for a page: one column, phone gutters, a max width. */
export function Column({
  children,
  className,
  wide,
}: {
  children: ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <div className={cn("mx-auto w-full px-4 sm:px-6", wide ? "max-w-6xl" : "max-w-[40rem]", className)}>
      {children}
    </div>
  );
}
