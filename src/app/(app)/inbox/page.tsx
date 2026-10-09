import { Note } from "@/components/bits";
import { ListTabs, StatusChips, parseListStatus } from "@/components/request/ListFilters";
import { db } from "@/db";
import { requireViewer } from "@/lib/viewer";
import * as requests from "@/services/requests";
import { RowList } from "./RowList";

const EMPTY = {
  open: "Nothing waiting on you. When someone asks you for something in Telegram, it shows up here.",
  done: "Nothing finished yet. Tick a request to mark it done.",
  all: "No one has asked you for anything yet.",
};

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ status?: string | string[] }> }) {
  const v = await requireViewer("/inbox");
  const status = parseListStatus((await searchParams).status);
  const [list, raised] = await Promise.all([
    requests.listInbox(db(), v.actor, { status }),
    requests.listRaised(db(), v.actor, { limit: 0 }),
  ]);
  return (
    <section className="flex flex-col gap-4">
      <h1 className="sr-only">To me</h1>
      <ListTabs current="inbox" inboxOpen={list.counts.open} raisedOpen={raised.counts.open} />
      <StatusChips base="/inbox" current={status} counts={list.counts} />
      {list.items.length ? <RowList items={list.items} meId={v.person.id} filter={status} mode="inbox" /> : <Note>{EMPTY[status]}</Note>}
    </section>
  );
}
