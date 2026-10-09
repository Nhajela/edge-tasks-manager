import { Shell } from "@/components/Shell";
import { db } from "@/db";
import { requireViewer } from "@/lib/viewer";
import * as requests from "@/services/requests";

export const dynamic = "force-dynamic";

/** Logged-in area: every page under (app) has a viewer. Pages call getViewer() again (cached per request). */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const v = await requireViewer();
  const { counts } = await requests.listInbox(db(), v.actor, { status: "open", limit: 1 });
  return (
    <Shell isAdmin={v.actor.isAdmin} inboxCount={counts.open}>
      {children}
    </Shell>
  );
}
