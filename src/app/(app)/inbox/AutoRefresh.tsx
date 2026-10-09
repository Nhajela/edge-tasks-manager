"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-fetch the server components every 30s while the tab is visible, and as soon as it becomes visible again. */
export function AutoRefresh({ every = 30_000 }: { every?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => document.visibilityState === "visible" && router.refresh();
    const id = setInterval(tick, every);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, every]);
  return null;
}
