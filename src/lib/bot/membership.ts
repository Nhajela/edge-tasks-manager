/**
 * The bot itself was added to / removed from a group (my_chat_member): DM the superadmin the chat id, and warn when
 * the bot can't see plain replies there (reply threads need privacy mode off or admin rights).
 */
import type { DbClient } from "@/db";
import { systemActor } from "@/lib/actor";
import { escapeHtml } from "@/lib/html";
import { tg } from "@/lib/telegram";
import * as people from "@/services/people";
import type { Effect } from "@/services/types";
import type { TgChatMemberUpdated } from "./types";

export type MembershipDeps = {
  /** Bot API getMe; null when unknown (no token, dev, network error) */
  getMe?: () => Promise<{ can_read_all_group_messages?: boolean } | null>;
};

const defaultGetMe = async () => {
  const res = (await tg("getMe", {})) as { ok: boolean; result?: { can_read_all_group_messages?: boolean } } | null;
  return res?.ok && res.result ? res.result : null;
};

export async function handleMembership(db: DbClient, u: TgChatMemberUpdated, deps: MembershipDeps = {}): Promise<Effect[]> {
  if (u.chat.type === "private") return [];
  const admin = await people.superadmin(db, systemActor());
  if (!admin?.telegramId) return [];

  const status = u.new_chat_member.status;
  const inGroup = status === "member" || status === "administrator" || status === "restricted";
  const by = u.from.username ? `@${escapeHtml(u.from.username)}` : escapeHtml(u.from.first_name ?? String(u.from.id));
  let html =
    `🤖 Bot is now <b>${escapeHtml(status)}</b> in “${escapeHtml(u.chat.title ?? "a group")}” ` +
    `(id <code>${u.chat.id}</code>), changed by ${by}.`;

  if (inGroup && status !== "administrator") {
    const me = await (deps.getMe ?? defaultGetMe)().catch(() => null);
    if (me && me.can_read_all_group_messages === false)
      html +=
        "\n\n⚠️ I can't read all messages in this group, so plain replies won't join request threads " +
        "(commands and replies to my own messages still work). Fix: BotFather → /setprivacy → Disable, " +
        "then remove and re-add me, or make me a group admin.";
  }

  return [{ kind: "notify", message: { chatId: Number(admin.telegramId), kind: "admin_ping", html, recipientPersonId: admin.id } }];
}
