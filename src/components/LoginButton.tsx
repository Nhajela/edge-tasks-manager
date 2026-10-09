"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Note } from "@/components/bits";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/feedback";

type Phase = "idle" | "starting" | "pending" | "expired" | "error";

const STORE_KEY = "etm-login";
const POLL_MS = 2000;
const TTL_MS = 10 * 60 * 1000;

const BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "";

/**
 * Telegram login: start → open t.me deep link → poll until the bot confirms.
 * Remembers an in-flight attempt in sessionStorage, so returning from Telegram
 * (which may reload this page in an in-app browser) resumes the wait.
 */
export function LoginButton({
  size = "lg",
  label = "Log in with Telegram",
  className,
  glass = false,
}: {
  size?: "default" | "lg";
  label?: string;
  className?: string;
  /** Floating pill on top of the hero art. */
  glass?: boolean;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [url, setUrl] = useState<string | null>(null);
  const startedAt = useRef<number>(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  const poll = useCallback(() => {
    stop();
    timer.current = setInterval(async () => {
      if (Date.now() - startedAt.current > TTL_MS) {
        stop();
        setPhase("expired");
        try {
          sessionStorage.removeItem(STORE_KEY);
        } catch {}
        return;
      }
      try {
        const res = await fetch("/api/auth/poll", { cache: "no-store" });
        const data = (await res.json()) as { status: "pending" | "ok" | "expired" };
        if (data.status === "ok") {
          stop();
          try {
            sessionStorage.removeItem(STORE_KEY);
          } catch {}
          router.refresh();
        } else if (data.status === "expired") {
          stop();
          setPhase("expired");
          try {
            sessionStorage.removeItem(STORE_KEY);
          } catch {}
        }
      } catch {
        /* transient network blip; keep polling */
      }
    }, POLL_MS);
  }, [router, stop]);

  // Resume a pending attempt after a reload (e.g. coming back from Telegram's in-app browser).
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const raw = sessionStorage.getItem(STORE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw) as { url: string; at: number };
        if (Date.now() - saved.at < TTL_MS) {
          startedAt.current = saved.at;
          setUrl(saved.url);
          setPhase("pending");
          poll();
        } else {
          sessionStorage.removeItem(STORE_KEY);
        }
      } catch {}
    }, 0);
    return () => {
      clearTimeout(t);
      stop();
    };
  }, [poll, stop]);

  const openTelegram = (u: string) => {
    // In Telegram's in-app browser window.open is often blocked; fall back to a navigation.
    const w = window.open(u, "_blank", "noopener");
    if (!w) window.location.href = u;
  };

  const start = async () => {
    setPhase("starting");
    try {
      const res = await fetch("/api/auth/start", { method: "POST" });
      if (!res.ok) throw new Error("start failed");
      const data = (await res.json()) as { url: string };
      startedAt.current = Date.now();
      setUrl(data.url);
      try {
        sessionStorage.setItem(STORE_KEY, JSON.stringify({ url: data.url, at: startedAt.current }));
      } catch {}
      setPhase("pending");
      poll();
      openTelegram(data.url);
    } catch {
      setPhase("error");
    }
  };

  const cancel = () => {
    stop();
    setPhase("idle");
    setUrl(null);
    try {
      sessionStorage.removeItem(STORE_KEY);
    } catch {}
  };

  if (phase === "pending" && url) {
    return (
      <div className={cn("flex flex-col gap-3", glass && "glass w-full max-w-md rounded-3xl p-4", className)}>
        <Note tone="teal" className={cn("flex items-start gap-3 py-3", glass && "bg-white/10 text-white")}>
          <span className="relative mt-1.5 flex size-2.5 shrink-0">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-teal opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex size-2.5 rounded-full bg-teal" />
          </span>
          <span>
            <strong className="font-semibold">Tap Start in Telegram, then come back here.</strong>
            <br />
            We&rsquo;re listening — this page updates by itself.
          </span>
        </Note>
        <div className="flex flex-wrap items-center gap-2">
          <Button render={<a href={url} target="_blank" rel="noopener" />} variant="outline">
            <Send data-icon="inline-start" />
            Open Telegram again
          </Button>
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (glass) {
    return (
      <div className={cn("glass flex w-full max-w-md flex-col items-stretch gap-2 rounded-[28px] p-2.5", className)}>
        <Button
          size="lg"
          onClick={start}
          disabled={phase === "starting"}
          aria-busy={phase === "starting"}
          className="h-13 w-full bg-white text-[16px] text-[#141b34] hover:bg-white/90"
        >
          {phase === "starting" ? <Spinner /> : <Send data-icon="inline-start" />}
          {phase === "starting" ? "Opening Telegram…" : label}
        </Button>
        <p className="px-2 pb-0.5 text-center text-[12px] leading-4 text-white/75">
          {phase === "expired"
            ? "That link expired. Try once more?"
            : phase === "error"
              ? "Couldn't reach Telegram. Try again."
              : BOT
                ? <>Or just message <a href={`https://t.me/${BOT}`} target="_blank" rel="noreferrer" className="underline underline-offset-2">@{BOT}</a> for a login link.</>
                : "Logs you in with Telegram."}
        </p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <div className="flex flex-wrap items-center gap-3">
        <Button size={size} onClick={start} disabled={phase === "starting"} aria-busy={phase === "starting"} className="w-full sm:w-auto">
          {phase === "starting" ? <Spinner /> : <Send data-icon="inline-start" />}
          {phase === "starting" ? "Opening Telegram…" : label}
        </Button>
        {phase === "expired" && (
          <span className="text-[14px] text-ink-soft">That link expired. Try once more?</span>
        )}
        {phase === "error" && (
          <span className="text-[14px] text-danger">Couldn&rsquo;t reach Telegram. Try again.</span>
        )}
      </div>
      {BOT && (
        <p className="text-[13px] leading-5 text-ink-mute">
          Or just message{" "}
          <a
            href={`https://t.me/${BOT}`}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-ink-soft underline decoration-line underline-offset-2 hover:text-ink"
          >
            @{BOT}
          </a>{" "}
          — it&rsquo;ll send you a login link.
        </p>
      )}
    </div>
  );
}
