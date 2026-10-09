import { timingSafeEqual } from "crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { superadminUsername } from "@/lib/admin";
import { handleCallback, handleStart } from "@/lib/bot/callbacks";
import { handleIntent } from "@/lib/bot/handlers";
import { handleMembership } from "@/lib/bot/membership";
import { parseUpdate } from "@/lib/bot/parse";
import type { TgUpdate } from "@/lib/bot/types";
import { BOT_USERNAME } from "@/lib/constants";
import { runEffects } from "@/lib/effects";
import { telegramNotifier } from "@/lib/telegram";
import * as chatBuffer from "@/services/chatBuffer";
import type { Effect } from "@/services/types";

export async function POST(req: NextRequest) {
  if (!secretOk(req.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const update = (await req.json().catch(() => ({}))) as TgUpdate;
  // Always 200 so Telegram doesn't retry (retries are deduped anyway, but a crash loop would spam).
  try {
    let effects: Effect[] = [];
    if (update.callback_query) effects = await handleCallback(db(), update.callback_query);
    else if (update.my_chat_member) effects = await handleMembership(db(), update.my_chat_member);
    else {
      const intent = parseUpdate(update, { botUsername: BOT_USERNAME, superadminUsername: superadminUsername() });
      const result =
        intent.kind === "start"
          ? await handleStart(db(), intent)
          : await handleIntent(db(), intent, { notifier: telegramNotifier, now: () => new Date() });
      effects = result.effects;
    }
    if (effects.length) after(() => runEffects(effects));
    // SPEC "Message buffer": group messages kept 3 days so a later request can pull in earlier replies
    const m = update.message;
    if (m && m.chat.type !== "private" && !m.from?.is_bot)
      after(() => chatBuffer.record(db(), m as unknown as chatBuffer.BufferedMessage & { chat: { id: number } }).catch((e) => console.error("chat buffer", e)));
  } catch (e) {
    console.error("telegram webhook error", e);
  }
  return NextResponse.json({ ok: true });
}

function secretOk(given: string | null) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
