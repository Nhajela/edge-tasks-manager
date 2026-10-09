import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Column, Mark } from "@/components/bits";

export default function NotFound() {
  return (
    <main className="flex flex-1 items-center py-16">
      <Column className="flex flex-col gap-5">
        <Mark size={36} />
        <h1 className="display text-[40px] font-bold sm:text-[52px]">No such page.</h1>
        <p className="max-w-[44ch] text-[16px] leading-7 text-ink-soft">
          That link points nowhere. Head back to your requests.
        </p>
        <div>
          <Button size="lg" render={<Link href="/" />}>
            Back home
          </Button>
        </div>
      </Column>
    </main>
  );
}
