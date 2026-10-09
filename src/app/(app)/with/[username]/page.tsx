import { notFound } from "next/navigation";
import { Note } from "@/components/bits";
import { db } from "@/db";
import { displayName } from "@/lib/names";
import { splitWith } from "@/lib/sections";
import { requireViewer } from "@/lib/viewer";
import * as people from "@/services/people";
import * as requests from "@/services/requests";
import { RowList } from "../../inbox/RowList";

const DAY = 86_400_000;

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
    { label: `${name} asked you`, items: toMe, view: "inbox" as const },
    { label: `You asked ${name}`, items: byMe, view: "raised" as const },
  ].filter((b) => b.items.length);

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
              {b.label} <span className="tnum font-normal text-ink-mute">{b.items.length}</span>
            </h2>
            <RowList items={b.items} meId={v.person.id} view={b.view} now={now.toISOString()} />
          </section>
        ))
      ) : (
        <Note>Nothing open between you and {name}, and nothing done in the last 14 days.</Note>
      )}
    </section>
  );
}
