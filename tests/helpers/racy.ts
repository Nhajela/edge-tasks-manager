import type { DbClient } from "@/db";

/**
 * A DbClient whose FIRST select runs `between()` after its rows are read but before they reach the caller:
 * deterministic "someone else wrote in between my read and my write" for race tests.
 */
export function racyDb(db: DbClient, between: () => Promise<unknown>): DbClient {
  let fired = false;
  const wrap = (b: object): object =>
    new Proxy(b, {
      get(t, p) {
        const v = Reflect.get(t, p);
        if (p === "then")
          return (ok: (x: unknown) => unknown, ko: (e: unknown) => unknown) =>
            (t as Promise<unknown>).then(async (rows) => (await between(), rows)).then(ok, ko);
        return typeof v === "function" ? (...a: unknown[]) => wrap(v.apply(t, a)) : v;
      },
    });
  return new Proxy(db, {
    get(t, p) {
      const v = Reflect.get(t, p);
      if (p !== "select" || fired) return typeof v === "function" ? v.bind(t) : v;
      fired = true;
      return (...a: unknown[]) => wrap(v.apply(t, a));
    },
  }) as DbClient;
}
