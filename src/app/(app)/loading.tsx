import { Bone } from "@/components/feedback";

/** Shown inside the Shell while a page loads: title, filter chips, a few rows. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-5" aria-busy aria-label="Loading">
      <Bone className="h-8 w-40" />
      <div className="flex gap-2">
        <Bone className="h-8 w-20 rounded-full" />
        <Bone className="h-8 w-16 rounded-full" />
        <Bone className="h-8 w-14 rounded-full" />
      </div>
      <div className="flex flex-col divide-y divide-line-soft rounded-[var(--radius-card)] border border-line-soft">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3.5">
            <Bone className="size-2.5 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Bone className="h-4 w-3/4" />
              <Bone className="h-3 w-1/3" />
            </div>
            <Bone className="h-6 w-14 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
