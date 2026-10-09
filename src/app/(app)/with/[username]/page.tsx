import { notFound } from "next/navigation";
import { Note } from "@/components/bits";
import { db } from "@/db";
import { displayName } from "@/lib/names";
import { splitWith, toSections } from "@/lib/sections";
import { requireViewer } from "@/lib/viewer";
import { groupInbox, groupRaised } from "@/services/grouping";
import * as people from "@/services/people";
import * as requests from "@/services/requests";
import type { ListItem } from "@/services/requests";
import { RowList } from "../../inbox/RowList";
import { Group } from "../Group";

const DAY = 86_400_000;

/** Same buckets as /inbox (they asked me) and /raised (I asked them). */
function bucket(items: ListItem[], now: Date, toMe: boolean) {
  try {
    return (toMe ? groupInbox(items, now) : groupRaised(items, now)).groups;
  } catch (e) {
    // ponytail: grouping.ts is a stub on this base (r2/grouping implements it); delete this fallback once merged
    if (!(e instanceof Error && e.message === "not implemented")) throw e;
    return toSections(items, toMe ? "inbox" : "raised")
      .filter((s) => s.items.length)
      .map((s) => ({ key: s.key, title: s.label, count: s.items.length, items: s.items, collapsedByDefault: s.collapsed }));
  }
}

/** Everything between me and one person, both directions, never interleaved (SPEC "Grouping"). */
export default async function WithPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const v = await requireViewer(`/with/${username}`);
  const other = await people.findByUsername(db(), decodeURIComponent(username));
  if (!other) notFound();
  const now = new Date();
  const list = await requests.listBetween(db(), v.actor, other.id, { status: "all", closedSince: new Date(+now - 14 * DAY) });
  const name = displayName(other);
  const { toMe, byMe } = splitWith(list.items, v.person.id);
  const blocks = [
    { label: `${name} asked you`, groups: bucket(toMe, now, true), n: toMe.length },
    { label: `You asked ${name}`, groups: bucket(byMe, now, false), n: byMe.length },
  ].filter((b) => b.n);

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="display text-[26px] font-bold leading-tight">You and {name}</h1>
        <p className="text-[14px] text-ink-soft">Open requests either of you asked the other, plus the last 14 days of done.</p>
      </div>
      {blocks.length ? (
        blocks.map((b) => (
          <section key={b.label} aria-label={b.label} className="flex flex-col gap-3">
            <h2 className="display text-[19px] font-bold">
              {b.label} <span className="tnum font-normal text-ink-mute">{b.n}</span>
            </h2>
            {b.groups.map((g) => (
              <Group key={g.key} title={g.title} count={g.count} collapsedByDefault={g.collapsedByDefault}>
                <RowList items={g.items} meId={v.person.id} filter="all" />
              </Group>
            ))}
          </section>
        ))
      ) : (
        <Note>Nothing open between you and {name}, and nothing done in the last 14 days.</Note>
      )}
    </section>
  );
}
