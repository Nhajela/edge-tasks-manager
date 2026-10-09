import type { Notifier } from "@/services/notifications";
import type { Effect } from "@/services/types";

export type EffectDeps = {
  notifier?: Notifier;
  titleRequest?: (requestId: number) => Promise<void>;
};

/**
 * Run the side effects a service returned. Adapters call it inside after() so the webhook/action returns fast:
 *   after(() => runEffects(result.effects));
 * Each effect is isolated: one failure is logged and never blocks the rest. Deps are injectable for tests.
 */
export async function runEffects(effects: Effect[], deps: EffectDeps = {}): Promise<void> {
  if (!effects.length) return;
  const notifier = deps.notifier ?? (await import("./telegram")).telegramNotifier;
  const titleRequest = deps.titleRequest ?? (await import("@/services/titler")).titleRequest;
  await Promise.all(
    effects.map(async (e) => {
      try {
        if (e.kind === "notify") await notifier.send(e.message);
        else if (e.kind === "title") await titleRequest(e.requestId);
      } catch (err) {
        console.error(`effect ${e.kind} failed`, err);
      }
    }),
  );
}
