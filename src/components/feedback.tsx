"use client";

import Link, { useLinkStatus } from "next/link";
import { useFormStatus } from "react-dom";
import type { ComponentProps, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The one spinner. */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin motion-reduce:animate-none", className)} aria-hidden />;
}

/** Shows a spinner next to a Link's label while that navigation is pending. Must be a child of <Link>. */
export function LinkHint({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  return (
    <span aria-hidden className={cn("inline-flex w-0 items-center overflow-hidden transition-[width]", pending && "w-5", className)}>
      <Spinner className="ml-1 size-3.5" />
    </span>
  );
}

/** A Link styled as a Button that also shows pending navigation. */
export function PendingLink({
  href,
  children,
  variant = "outline",
  size = "default",
  className,
  prefetch,
}: {
  href: ComponentProps<typeof Link>["href"];
  children: ReactNode;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  className?: string;
  prefetch?: boolean;
}) {
  return (
    <Button variant={variant} size={size} className={className} render={<Link href={href} prefetch={prefetch} />}>
      {children}
      <LinkHint />
    </Button>
  );
}

/** Submit button for plain <form action={serverAction}>: pending via useFormStatus. */
export function SubmitButton({
  children,
  pendingLabel,
  className,
  variant = "default",
  size = "default",
}: {
  children: ReactNode;
  pendingLabel?: ReactNode;
  className?: string;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} className={className} disabled={pending} aria-busy={pending}>
      {pending && <Spinner />}
      {pending ? pendingLabel ?? children : children}
    </Button>
  );
}

/** Skeleton block. */
export function Bone({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden />;
}
