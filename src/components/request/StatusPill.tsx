import { Tag } from "@/components/bits";
import { STATUS_LABEL } from "@/lib/constants";
import type { Status } from "@/lib/types";

const TONE = { open: "blue", in_progress: "teal", waiting: "marigold", done: "neutral", declined: "danger" } as const;

/** Status pill; a custom label ("ordering from Panjim") replaces the name but keeps the status colour. */
export function StatusPill({ status, customStatus, className }: { status: Status; customStatus?: string | null; className?: string }) {
  return (
    <Tag tone={TONE[status]} className={className} title={customStatus ? STATUS_LABEL[status] : undefined}>
      {customStatus || STATUS_LABEL[status]}
    </Tag>
  );
}
