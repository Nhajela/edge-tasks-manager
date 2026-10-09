import { ListTabs } from "@/components/request/ListFilters";
import { db } from "@/db";
import { requireViewer } from "@/lib/viewer";
import * as requests from "@/services/requests";
import { AutoRefresh } from "./AutoRefresh";
import { CaughtUp } from "./CaughtUp";
import { RowList } from "./RowList";

const DONE_DAYS = 14;

export default async function InboxPage() {
  const v = await requireViewer("/inbox");
  const now = new Date();
  const [list, raised] = await Promise.all([
    requests.listInbox(db(), v.actor, { status: "all", closedSince: new Date(+now - DONE_DAYS * 86400_000), limit: 500 }),
    requests.listRaised(db(), v.actor, { limit: 0 }),
  ]);
  return (
    <section className="flex flex-col gap-5">
      <h1 className="sr-only">To me</h1>
      <AutoRefresh />
      <ListTabs current="inbox" inboxOpen={list.counts.open} raisedOpen={raised.counts.open} />
      <RowList
        items={list.items}
        meId={v.person.id}
        view="inbox"
        now={now.toISOString()}
        empty={<CaughtUp lead="Nothing waiting on you. When someone asks you for something in Telegram, it shows up here." />}
      />
    </section>
  );
}
