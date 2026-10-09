/**
 * Telegram Bot API shapes we read (only the fields we use) and the Intent union that parseUpdate() produces.
 * Contract between src/lib/bot/parse.ts (pure) and src/lib/bot/handlers.ts (DB + Telegram). Keep stable.
 */
import type { AttachmentInput } from "@/services/requests";
import type { Status } from "@/lib/types";
import type { Effect } from "@/services/types";

export type TgUser = { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string };

export type TgChat = { id: number; type: "private" | "group" | "supergroup" | "channel"; title?: string; username?: string };

/** `mention` (@username in text), `text_mention` (user without username: carries `user`), `bot_command`, ... */
export type TgEntity = { type: string; offset: number; length: number; user?: TgUser };

export type TgPhotoSize = { file_id: string; file_unique_id: string; width: number; height: number; file_size?: number };

export type TgDocument = { file_id: string; file_unique_id: string; file_name?: string; mime_type?: string; file_size?: number };

export type TgMessage = {
  message_id: number;
  date: number;
  chat: TgChat;
  from?: TgUser;
  /** forum topic id in forums; in plain supergroups, the root of the reply chain */
  message_thread_id?: number;
  /** true only for messages sent inside a forum topic */
  is_topic_message?: boolean;
  /** set on a forum topic's service message (the root every topic message points at) */
  forum_topic_created?: object;
  text?: string;
  caption?: string;
  entities?: TgEntity[];
  caption_entities?: TgEntity[];
  reply_to_message?: TgMessage;
  /** sizes, smallest first */
  photo?: TgPhotoSize[];
  document?: TgDocument;
};

export type TgCallbackQuery = { id: string; from: TgUser; data?: string; message?: TgMessage };

export type TgChatMemberUpdated = {
  chat: TgChat;
  from: TgUser;
  date: number;
  old_chat_member: { status: string; user: TgUser };
  new_chat_member: { status: string; user: TgUser };
};

export type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  callback_query?: TgCallbackQuery;
  my_chat_member?: TgChatMemberUpdated;
};

/** Who a parsed intent points at. The handler resolves it to a people row (upserting). */
export type PersonRef =
  /** a Telegram user we saw (sender, replied-to author, text_mention entity) */
  | { by: "user"; user: TgUser }
  /** "@bob": lowercase, no @ */
  | { by: "username"; username: string }
  /** no assignee given: the organiser (SUPERADMIN_USERNAME) */
  | { by: "superadmin" };

/** What every message-borne intent carries: the triggering message and its chat/sender. */
export type MessageCtx = { message: TgMessage; chat: TgChat; from: TgUser };

export type ListCommand = "mine" | "raised" | "with" | "status" | "help";

export type Intent =
  /**
   * /request, /request@bot, or a leading @bot mention. `source` is the replied-to message (its text is the body,
   * its photo attached), else null and the body is the command text. `note` = text after the command when replying.
   */
  | ({
      kind: "request";
      via: "command" | "mention";
      requester: PersonRef;
      assignee: PersonRef;
      body: string;
      note: string | null;
      source: TgMessage | null;
      /** photos/documents from the command message and the source */
      attachments: AttachmentInput[];
    } & MessageCtx)
  /**
   * /append (/add, /more). `requestId` when given ("/append 12"); otherwise the handler resolves from `replyTo`:
   * a bot message -> findRequestByTelegramMessage, a human message -> findAppendTarget(author).
   * `payload` is the message whose text/photo gets attached (the replied message, or the command itself when
   * replying to the bot with text). `text` is what goes into the body.
   */
  | ({
      kind: "append";
      requestId: number | null;
      replyTo: TgMessage | null;
      payload: TgMessage;
      text: string;
      attachments: AttachmentInput[];
    } & MessageCtx)
  /**
   * Plain reply (no command) to a non-bot message. The handler stores it as a thread message only if
   * findRequestByTelegramMessage(chat, replyToMessageId) resolves; otherwise ignores it (never stored).
   */
  | ({ kind: "thread"; replyToMessageId: number; text: string; attachments: AttachmentInput[] } & MessageCtx)
  /**
   * Plain reply (no command) to one of the bot's own messages. Handler order: prompts.consume (a "What should
   * @bob do?" prompt -> create the request with this text as body); else the bot message belongs to a request ->
   * append (SPEC: replying to the "#12 created" confirmation appends); else ignore.
   */
  | ({ kind: "pending-reply"; botMessageId: number; text: string; attachments: AttachmentInput[] } & MessageCtx)
  /** `@bot @bob` with no text and no reply: ask "What should @bob do?" and create a pending prompt. */
  | ({ kind: "prompt"; assignee: PersonRef } & MessageCtx)
  /**
   * /done /doing /waiting /decline /reopen (and a leading "@bot done" / "@bot on it"). `requestId` when given ("/done 12"),
   * else the handler resolves `replyToMessageId` through the reply chain. `note`: the text after it (for /waiting, the label).
   */
  | ({ kind: "status"; status: Status; requestId: number | null; replyToMessageId: number | null; note: string | null; attachments: AttachmentInput[] } & MessageCtx)
  /** /mine /raised /help, /with @bob (`who`), /status 12 (`requestId`; null -> reply with usage). */
  | ({ kind: "list"; command: ListCommand; who: PersonRef | null; requestId: number | null } & MessageCtx)
  /** /start [code] in a DM: the eci-travel-coop login flow ("Yes, log me in" button), or a plain welcome. */
  | ({ kind: "start"; code: string | null } & MessageCtx)
  /** Callback button "Yes, log me in" (callback_data `login:<code>`). */
  | { kind: "login-confirm"; code: string; callbackQueryId: string; from: TgUser; message: TgMessage | null }
  /** "✅ Done" / "🔄 On it" buttons on the assignee DM (callback_data `st:<requestId>:<done|in_progress>`). */
  | { kind: "status-button"; requestId: number; status: "done" | "in_progress"; callbackQueryId: string; from: TgUser; message: TgMessage | null }
  /** Bare `@bot` with no text and no reply: short help reply, nothing created. */
  | ({ kind: "help-mention" } & MessageCtx)
  /** The bot was added to / removed from a chat (warn the superadmin if it can't read messages). */
  | { kind: "membership"; chat: TgChat; from: TgUser; status: string }
  /** Bots, edits, channel posts, mentions later in a sentence, unknown commands, ... */
  | { kind: "ignore"; reason: string };

export type IntentKind = Intent["kind"];

/** What handleIntent did. Replies are already sent (via deps.notifier); `effects` go to after(runEffects). */
export type HandlerResult = {
  /** short machine-readable outcome, e.g. "request.created", "append.duplicate", "ignored" */
  outcome: string;
  requestId?: number | null;
  effects: Effect[];
};
