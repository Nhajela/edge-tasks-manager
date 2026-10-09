/** All buckets empty: say so, and teach the bot commands that fill them. */
export function CaughtUp({ lead }: { lead: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-sand px-4 py-4 text-[14px] leading-5 text-ink-soft">
      <p className="text-[17px] font-semibold text-ink">You&apos;re all caught up 🌊</p>
      <p>{lead}</p>
      <ul className="flex flex-col gap-1">
        <li>
          <code className="font-semibold text-ink">/request @name what you need</code> in any group with the bot
        </li>
        <li>
          <code className="font-semibold text-ink">/mine</code> · <code className="font-semibold text-ink">/raised</code> to list them in Telegram
        </li>
        <li>
          <code className="font-semibold text-ink">/done 12</code> when it&apos;s finished
        </li>
      </ul>
    </div>
  );
}
