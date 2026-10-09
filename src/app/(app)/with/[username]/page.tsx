import { notFound } from "next/navigation";
import { Note } from "@/components/bits";
import { StatusChips, parseListStatus } from "@/components/request/ListFilters";
import { db } from "@/db";
import { displayName } from "@/lib/names";
import { splitWith } from "@/lib/sections";
import { requireViewer } from "@/lib/viewer";
import * as people from "@/services/people";
import * as requests from "@/services/requests";
import { RowList } from "../../inbox/RowList";

/** Everything between me and one person, both directions. */
export default async function WithPage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const { username } = await params;
  const v = await requireViewer(`/with/${username}`);
  const other = await people.findByUsername(db(), decodeURIComponent(username));
  if (!other) notFound();
  const status = parseListStatus((await searchParams).status);
  const list = await requests.listBetween(db(), v.actor, other.id, { status });
  const name = displayName(other);
  const blocks = splitWith(list.items, v.person.id);
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h1 className="display text-[26px] font-bold leading-tight">You and {name}</h1>
        <p className="text-[14px] text-ink-soft">Requests either of you asked the other.</p>
      </div>
      <StatusChips base={`/with/${other.username}`} current={status} counts={list.counts} />
      {list.items.length ? (
        // SPEC "Grouping": never interleave directions
        [
          { label: `${name} asked you`, rows: blocks.toMe },
          { label: `You asked ${name}`, rows: blocks.byMe },
        ]
          .filter((b) => b.rows.length)
          .map((b) => (
            <section key={b.label} aria-label={b.label}>
              <h2 className="mb-2 text-[15px] font-semibold">
                {b.label} <span className="font-normal text-ink-mute">{b.rows.length}</span>
              </h2>
              <RowList items={b.rows} meId={v.person.id} filter={status} />
            </section>
          ))
      ) : (
        <Note>{status === "open" ? `Nothing open between you and ${name}.` : `Nothing here between you and ${name}.`}</Note>
      )}
    </section>
  );
}
