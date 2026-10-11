import { randomBytes } from "node:crypto";
import Link from "next/link";
import type { ReactNode } from "react";
import { Note, SectionTitle } from "@/components/bits";
import { CodeBlock } from "@/components/settings/McpAccess";
import { RingSettings } from "@/components/settings/RingSettings";
import { db } from "@/db";
import { requireViewer } from "@/lib/viewer";
import * as ring from "@/services/ring";

export const metadata = { title: "Urgent ring" };

const NTFY = process.env.NTFY_URL || "https://ntfy.sh";
const APPS = [
  { name: "Android (Google Play)", href: "https://play.google.com/store/apps/details?id=io.heckel.ntfy" },
  { name: "Android (F-Droid)", href: "https://f-droid.org/packages/io.heckel.ntfy/" },
  { name: "iPhone (App Store)", href: "https://apps.apple.com/app/ntfy/id1625396347" },
];

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sand text-[14px] font-semibold">{n}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
        <h3 className="font-semibold">{title}</h3>
        {children}
      </div>
    </li>
  );
}

export default async function RingPage() {
  const { actor } = await requireViewer("/settings/ring");
  const saved = await ring.getMine(db(), actor);
  // a fresh secret each visit until one is saved; anyone who knows the topic can ring it
  const topic = saved?.ntfyTopic ?? `etm-${randomBytes(9).toString("hex")}`;

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Link href="/settings" className="w-fit text-[14px] font-medium text-blue-deep hover:underline">
          ← Settings
        </Link>
        <h1 className="display text-[28px] font-bold">Urgent ring</h1>
        <p className="text-ink-soft">
          When someone sends <code className="rounded-md bg-sand px-1.5 font-mono text-[14px]">/urgent_request</code> to you, your phone rings, not just a
          Telegram ping. It uses <a href="https://ntfy.sh" target="_blank" rel="noreferrer" className="font-medium text-blue-deep hover:underline">ntfy</a>, a
          free, open-source push app. No account needed.
        </p>
      </div>

      <ol className="flex flex-col gap-6">
        <Step n={1} title="Install the ntfy app">
          <div className="flex flex-wrap gap-2">
            {APPS.map((a) => (
              <a key={a.href} href={a.href} target="_blank" rel="noreferrer" className="rounded-full border border-line-soft bg-card px-3.5 py-1.5 text-[14px] font-medium hover:bg-sand">
                {a.name}
              </a>
            ))}
          </div>
        </Step>

        <Step n={2} title="Subscribe to your secret topic">
          <p className="text-[14px] text-ink-soft">
            In the app tap <b>+</b>, paste this topic, keep the default server ({NTFY.replace(/^https?:\/\//, "")}). Treat it like a password: anyone who knows it can
            ring you.
          </p>
          <CodeBlock title="Your topic" code={topic} />
          {!saved && <p className="text-[13px] text-ink-mute">Made up just for you. It changes if you reload before saving, so save it in step 4.</p>}
        </Step>

        <Step n={3} title="Make it loud">
          <ul className="list-disc space-y-1 pl-5 text-[14px] text-ink-soft">
            <li>
              <b>Android:</b> open the topic in ntfy, then its notification settings. Turn on overriding Do Not Disturb for max priority and pick a loud sound.
              Turn off battery optimisation for ntfy so it isn&apos;t killed in the background.
            </li>
            <li>
              <b>iPhone:</b> allow ntfy notifications with sound. iOS won&apos;t let ntfy ring through silent mode or a Focus, so add ntfy to your Focus&apos;s
              allowed apps.
            </li>
          </ul>
        </Step>

        <Step n={4} title="Save it here and test">
          <RingSettings initial={saved} suggested={topic} />
        </Step>
      </ol>

      <div className="flex flex-col gap-3">
        <SectionTitle>Handy</SectionTitle>
        <CodeBlock title="Ring from a terminal" hint="Same push the bot sends. Works from any machine." code={`curl -H "Priority: 5" -d "test ring" ${NTFY}/${topic}`} />
        <CodeBlock title="Watch it in a browser" hint="Open on a laptop to see rings there too." code={`${NTFY}/${topic}`} />
        <CodeBlock title="Send an urgent request" hint="In any group with the bot. No @name goes to the organiser." code="/urgent_request @bob the generator is smoking" />
        <Note>
          Who can ring you: by default anyone who uses /urgent_request on you. Put usernames in step 4 to allow only them. Others can still send you an urgent
          request; it just won&apos;t ring.
        </Note>
      </div>
    </section>
  );
}
