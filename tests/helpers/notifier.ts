import type { Notifier } from "@/services/notifications";
import type { OutgoingMessage } from "@/services/types";

/** A Notifier that records instead of calling Telegram. `blockedChatIds` simulate a 403. */
export function capturingNotifier(opts: { blockedChatIds?: number[] } = {}) {
  const sent: OutgoingMessage[] = [];
  let nextId = 1;
  const notifier: Notifier = {
    async send(m) {
      sent.push(m);
      if (opts.blockedChatIds?.includes(m.chatId)) return { ok: false, blocked: true, description: "Forbidden" };
      return { ok: true, messageId: nextId++ };
    },
  };
  return { notifier, sent };
}
