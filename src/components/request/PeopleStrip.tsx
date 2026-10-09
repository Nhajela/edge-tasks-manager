import Link from "next/link";
import { displayName } from "@/lib/names";
import { cn } from "@/lib/utils";
import type { PersonSummary } from "@/services/grouping";

function Chip({ p }: { p: PersonSummary }) {
  const body = (
    <>
      <span className="truncate font-semibold text-ink">{displayName(p.person)}</span>
      <span className="whitespace-nowrap text-[12.5px] text-ink-soft">
        {p.open} open
        {p.overdue > 0 && <span className="font-medium text-danger"> · {p.overdue} overdue</span>}
        {p.waiting > 0 && <> · {p.waiting} waiting</>}
      </span>
    </>
  );
  const cls = cn("flex min-h-11 max-w-full flex-col justify-center rounded-[12px] border px-3 py-1.5 text-[14px]", p.overdue ? "border-danger/30" : "border-line-soft");
  return (
    <li className="min-w-0">
      {p.person.username ? (
        <Link href={`/with/${p.person.username}`} className={cn(cls, "hover:bg-sand")}>
          {body}
        </Link>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}

/** Who has your requests: people with overdue/waiting items first; on-track people behind "Show N more". */
export function PeopleStrip({ people }: { people: PersonSummary[] }) {
  if (!people.length) return null;
  const flagged = people.filter((p) => !p.onTrack);
  const onTrack = people.filter((p) => p.onTrack);
  const list = (ps: PersonSummary[]) => (
    <ul className="flex flex-wrap gap-2">
      {ps.map((p) => (
        <Chip key={p.person.id} p={p} />
      ))}
    </ul>
  );
  return (
    <section aria-label="People" className="flex flex-col gap-2">
      <h2 className="text-[15px] font-semibold">People</h2>
      {flagged.length > 0 && list(flagged)}
      {onTrack.length > 0 &&
        (flagged.length ? (
          <details className="group">
            <summary className="min-h-10 cursor-pointer list-none text-[13.5px] font-medium text-ink-soft hover:text-ink group-open:mb-2">
              <span className="group-open:hidden">Show {onTrack.length} more (on track)</span>
              <span className="hidden group-open:inline">On track</span>
            </summary>
            {list(onTrack)}
          </details>
        ) : (
          list(onTrack)
        ))}
    </section>
  );
}
