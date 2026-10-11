import type { Notifier } from "@/services/notifications";
import type { Effect } from "@/services/types";

export type EffectDeps = {
  notifier?: Notifier;
  titleRequest?: (requestId: number) => Promise<void>;
  fetch?: typeof fetch;
};

const NTFY_URL = process.env.NTFY_URL || "https://ntfy.sh";

/** One max-priority ntfy push. JSON publish: a header-based Title can't carry non-Latin-1 text. */
export async function sendRing(e: Extract<Effect, { kind: "ring" }>, f: typeof fetch = fetch) {
  const res = await f(NTFY_URL, {
    method: "POST",
    body: JSON.stringify({ topic: e.topic, title: "🚨 Urgent request", message: e.title, priority: 5, tags: ["rotating_light"], click: e.url }),
  });
  if (!res.ok) throw new Error(`ntfy ${res.status}`);
}

/**
 * Run the side effects a service returned. Adapters call it inside after() so the webhook/action returns fast:
 *   after(() => runEffects(result.effects));
 * Each effect is isolated: one failure is logged and never blocks the rest. Deps are injectable for tests.
 */
export async function runEffects(effects: Effect[], deps: EffectDeps = {}): Promise<void> {
  if (!effects.length) return;
  const notifier = deps.notifier ?? (await import("./telegram")).telegramNotifier;
  const titleRequest =
    deps.titleRequest ??
    (async (id: number) => (await import("@/services/titler")).titleRequest((await import("@/db")).db(), id));
  await Promise.all(
    effects.map(async (e) => {
      try {
        if (e.kind === "notify") await notifier.send(e.message);
        else if (e.kind === "title") await titleRequest(e.requestId);
        else if (e.kind === "ring") await sendRing(e, deps.fetch);
      } catch (err) {
        console.error(`effect ${e.kind} failed`, err);
      }
    }),
  );
}
