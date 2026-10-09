"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

/** Light/dark switch. Light is the default; next-themes remembers the choice per browser. */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // icons switch via the .dark class (set before paint), so server and client render the same markup
  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      aria-label="Toggle dark mode"
      title="Light / dark"
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-sand hover:text-ink focus-visible:outline-2 focus-visible:outline-teal"
    >
      <MoonIcon className="size-[18px] dark:hidden" />
      <SunIcon className="hidden size-[18px] dark:block" />
    </button>
  );
}
