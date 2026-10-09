import Link from "next/link";
import { displayName } from "@/lib/names";
import type { Person } from "@/lib/types";
import { cn } from "@/lib/utils";

/** "@bob" (or first name), linking to /with/<username> when they have one. */
export function PersonChip({
  person,
  link = true,
  className,
}: {
  person: Pick<Person, "username" | "firstName"> | null;
  link?: boolean;
  className?: string;
}) {
  const cls = cn("inline-flex max-w-full items-center truncate font-medium text-ink", className);
  if (link && person?.username)
    return (
      <Link href={`/with/${person.username}`} className={cn(cls, "underline-offset-2 hover:underline")}>
        {displayName(person)}
      </Link>
    );
  return <span className={cls}>{displayName(person)}</span>;
}
