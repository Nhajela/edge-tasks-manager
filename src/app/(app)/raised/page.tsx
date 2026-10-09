import { Note } from "@/components/bits";
import { ListTabs } from "@/components/request/ListFilters";
import { PeopleStrip } from "@/components/request/PeopleStrip";
import { StatTiles, parseTile, tileMatches } from "@/components/request/StatTiles";
import { db } from "@/db";
import { requireViewer } from "@/lib/viewer";
import { groupRaised } from "@/services/grouping";
import * as requests from "@/services/requests";
import { AutoRefresh } from "../inbox/AutoRefresh";
import { CaughtUp } from "../inbox/CaughtUp";
import { RowList } from "../inbox/RowList";

const DONE_DAYS = 14;

export default async function RaisedPage({ searchParams }: { searchParams: Promise<{ tile?: string | string[] }> }) {
  const v = await requireViewer("/raised");
  const tile = parseTile((await searchParams).tile);
  const now = new Date();
  const [list, inbox] = await Promise.all([
    requests.listRaised(db(), v.actor, { status: "all", closedSince: new Date(+now - DONE_DAYS * 86400_000), limit: 500 }),
    requests.listInbox(db(), v.actor, { limit: 0 }),
  ]);
  const { tiles, people } = groupRaised(list.items, now);
  const items = tile ? list.items.filter((i) => tileMatches(tile, i, now)) : list.items;
  const tileTitle = tiles.find((t) => t.key === tile)?.title;
  return (
    <section className="flex flex-col gap-5">
      <h1 className="sr-only">I asked</h1>
      <AutoRefresh />
      <ListTabs current="raised" inboxOpen={inbox.counts.open} raisedOpen={list.counts.open} />
      {list.items.length > 0 && <StatTiles tiles={tiles} base="/raised" current={tile} />}
      <RowList
        key={tile ?? "all"}
        items={items}
        meId={v.person.id}
        view="raised"
        now={now.toISOString()}
        expand={!!tile}
        empty={
          tile ? (
            <Note>Nothing in “{tileTitle}”. Tap the tile again to see everything.</Note>
          ) : (
            <CaughtUp lead="Nothing open that you asked for. Ask someone from any Telegram group with the bot:" />
          )
        }
      />
      {!tile && <PeopleStrip people={people} />}
    </section>
  );
}
