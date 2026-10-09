"use client";

import { useTransition, type ComponentProps } from "react";
import { toast } from "sonner";
import type { ActionResult } from "./actions";

/**
 * A <form> for one of ./actions: toasts the result and clears its fields only on success (a plain
 * <form action> would also wipe a half-typed answer when validation fails). Fields are disabled while it runs.
 */
export function ActionForm({
  action,
  onDone,
  children,
  ...props
}: Omit<ComponentProps<"form">, "action" | "onSubmit"> & {
  action: (fd: FormData) => Promise<ActionResult>;
  onDone?: () => void;
}) {
  const [pending, start] = useTransition();
  return (
    <form
      {...props}
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form, (e.nativeEvent as SubmitEvent).submitter);
        start(async () => {
          const r = await action(fd);
          if (r.error) return void toast.error(r.error);
          if (r.ok) toast.success(r.ok);
          form.reset();
          onDone?.();
        });
      }}
    >
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
    </form>
  );
}
