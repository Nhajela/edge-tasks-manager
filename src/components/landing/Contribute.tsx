import { ArrowUpRight } from "lucide-react";
import { Column } from "@/components/bits";
import { buttonVariants } from "@/components/ui/button";

const REPO_URL = "https://github.com/Nhajela/edge-tasks-manager";

/** lucide dropped brand icons, so the GitHub mark lives here. */
function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.39-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

/** Landing-page call to contribute on GitHub. */
export function Contribute() {
  return (
    <Column wide className="py-10 sm:py-16">
      <section
        id="contribute"
        className="flex flex-col items-start gap-6 rounded-[var(--radius-card)] border border-line-soft bg-sand p-6 sm:flex-row sm:items-center sm:gap-10 sm:p-10"
      >
        <GitHubMark className="size-14 shrink-0 sm:size-20" />
        <div className="flex flex-1 flex-col gap-3">
          <h2 className="display text-[28px] font-bold leading-[1.1] sm:text-[38px]">Contribute</h2>
          <p className="max-w-[52ch] text-[16px] leading-7 text-ink-soft">
            Edge Tasks is open source. Found a bug, want a new command, or have an idea to make it better? Open an
            issue or send a pull request on GitHub.
          </p>
        </div>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ size: "lg", className: "shrink-0" })}
        >
          <GitHubMark />
          View on GitHub
          <ArrowUpRight />
        </a>
      </section>
    </Column>
  );
}
