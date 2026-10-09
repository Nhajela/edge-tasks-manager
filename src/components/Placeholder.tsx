/** Stand-in page body until the web UI agent builds the real page. */
export function Placeholder({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h1 className="display text-[28px] font-bold">{title}</h1>
      <p className="text-ink-soft">Coming soon.</p>
      {children}
    </section>
  );
}
