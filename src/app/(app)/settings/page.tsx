import { logout } from "@/app/auth/actions";
import { Initial, SectionTitle, Tag } from "@/components/bits";
import { McpAccess } from "@/components/settings/McpAccess";
import { Button } from "@/components/ui/button";
import { BOT_USERNAME } from "@/lib/constants";
import { displayName } from "@/lib/names";
import { requireViewer } from "@/lib/viewer";

const bot = BOT_USERNAME ? `@${BOT_USERNAME}` : "@bot";

/** Short version of the bot rules in docs/SPEC.md ("Telegram bot"). */
const CHEATS: { cmd: string; what: string }[] = [
  { cmd: "/request @bob fix the projector", what: "Ask Bob. Works in any group the bot is in, or in a DM." },
  { cmd: "/request fix the projector", what: "No @name: it goes to the organiser." },
  { cmd: `${bot} @bob fix the projector`, what: "Same as /request. The bot mention has to come first." },
  { cmd: "Reply with /request", what: "Reply to someone's message: they asked, you'll do it. Add @bob to give it to Bob." },
  { cmd: "Reply with /append", what: "Adds that message to its author's latest open request. /append 12 adds it to #12. Also /add." },
  { cmd: "Reply to the bot's “#12” message", what: "Your text is added to #12. Replies to a request's messages show up in its thread." },
  { cmd: "/mine · /raised · /with @bob", what: "Open requests to you, from you, or between you and Bob." },
  { cmd: "/status 12 · /done 12", what: "Check or finish #12." },
  { cmd: "Reply with /done · /doing · /waiting · /decline · /reopen", what: "Changes the status of the request that message belongs to. Add a note after it." },
];

export default async function SettingsPage() {
  const { person, actor } = await requireViewer("/settings");
  const name = displayName(person);

  return (
    <section className="flex flex-col gap-8">
      <h1 className="display text-[28px] font-bold">Settings</h1>

      <div>
        <SectionTitle>Account</SectionTitle>
        <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line-soft bg-card p-4">
          <Initial name={person.firstName || name.replace(/^@/, "")} you />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{person.firstName || name}</p>
            <p className="truncate text-[14px] text-ink-mute">
              {person.username ? `@${person.username}` : "No Telegram username"}
              {actor.isAdmin && (
                <Tag tone="marigold" className="ml-2 align-middle">
                  Admin
                </Tag>
              )}
            </p>
          </div>
          <form action={logout}>
            <Button type="submit" variant="outline">
              Log out
            </Button>
          </form>
        </div>
      </div>

      <div>
        <SectionTitle
          aside={
            BOT_USERNAME && (
              <a href={`https://t.me/${BOT_USERNAME}`} target="_blank" rel="noreferrer" className="font-medium text-blue-deep hover:underline">
                Open {bot}
              </a>
            )
          }
        >
          Using the bot
        </SectionTitle>
        <ul className="divide-y divide-line-soft rounded-[var(--radius-card)] border border-line-soft bg-card">
          {CHEATS.map((c) => (
            <li key={c.cmd} className="flex flex-col gap-1 px-4 py-3">
              <code className="w-fit max-w-full break-words rounded-md bg-sand px-2 py-0.5 font-mono text-[13.5px] text-ink">{c.cmd}</code>
              <span className="text-[14px] leading-5 text-ink-soft">{c.what}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[13.5px] text-ink-mute">Photos in or replied-to by a request get attached. Type /help in Telegram for the full list.</p>
      </div>

      <div>
        <SectionTitle>AI agents (MCP)</SectionTitle>
        <McpAccess />
      </div>
    </section>
  );
}
