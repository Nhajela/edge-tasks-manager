import { Note } from "@/components/bits";
import { ListTabs, StatusChips, parseListStatus } from "@/components/request/ListFilters";
import { db } from "@/db";
import { requireViewer } from "@/lib/viewer";
import * as requests from "@/services/requests";
import { RowList } from "../inbox/RowList";

const EMPTY = {
  open: "Nothing open that you asked for. In any Telegram group with the bot, try: /request @name what you need",
  done: "None of your requests are finished yet.",
  all: "You haven't asked anyone for anything yet. In Telegram, try: /request @name what you need",
};

export default async function RaisedPage({ searchParams }: { searchParams: Promise<{ status?: string | string[] }> }) {
  const v = await requireViewer("/raised");
  const status = parseListStatus((await searchParams).status);
  const [list, inbox] = await Promise.all([
    requests.listRaised(db(), v.actor, { status }),
    requests.listInbox(db(), v.actor, { limit: 0 }),
  ]);
  return (
    <section className="flex flex-col gap-4">
      <h1 className="sr-only">I asked</h1>
      <ListTabs current="raised" inboxOpen={inbox.counts.open} raisedOpen={list.counts.open} />
      <StatusChips base="/raised" current={status} counts={list.counts} />
      {list.items.length ? <RowList items={list.items} meId={v.person.id} filter={status} /> : <Note>{EMPTY[status]}</Note>}
    </section>
  );
}
