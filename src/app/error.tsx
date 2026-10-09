"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Column, Mark } from "@/components/bits";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex flex-1 items-center py-16">
      <Column className="flex flex-col gap-5">
        <Mark size={36} />
        <h1 className="display text-[40px] font-bold sm:text-[52px]">Something went sideways.</h1>
        <p className="max-w-[44ch] text-[16px] leading-7 text-ink-soft">
          Not your fault. We&rsquo;ve logged it for the organisers. Try again — and if it keeps happening, tell us what you
          were doing.
        </p>
        {error.digest && <p className="text-[12.5px] text-ink-mute tnum">Reference {error.digest}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" onClick={() => reset()}>
            Try again
          </Button>
          <Button variant="outline" size="lg" render={<Link href="/" />}>
            Back home
          </Button>
        </div>
      </Column>
    </main>
  );
}
