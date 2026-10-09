import { Column, Mark } from "@/components/bits";

export function SiteFooter() {
  return (
    <footer className="border-t border-line-soft bg-sand/60">
      <Column className="flex flex-col gap-3 py-6 text-[13.5px] leading-5 text-ink-mute sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-2">
          <Mark size={18} className="mt-0.5 shrink-0 opacity-80" />
          <span>
            Edge Tasks, made for{" "}
            <a
              href="https://edgecity.live/india26"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-ink-soft underline decoration-line underline-offset-2 hover:text-ink"
            >
              Edge City India
            </a>
            , 11 Oct – 1 Nov 2026 at Riva Beach Resort, Mandrem. Ask anyone for anything, right from Telegram.
            <span className="mt-1 block">
              A community project by Edge City attendees, not an official Edge City app. Started by{" "}
              <a
                href="https://t.me/HiiNaman"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-ink-soft underline decoration-line underline-offset-2 hover:text-ink"
              >
                @HiiNaman
              </a>{" "}
              — message him to contribute, extend it, or report a bug.
            </span>
          </span>
        </p>
      </Column>
    </footer>
  );
}
