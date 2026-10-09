import { Shell } from "@/components/Shell";
import { requireViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/** Logged-in area: every page under (app) has a viewer. Pages call getViewer() again (cached per request). */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const v = await requireViewer();
  return (
    <Shell session={v.session} isAdmin={v.actor.isAdmin}>
      {children}
    </Shell>
  );
}
