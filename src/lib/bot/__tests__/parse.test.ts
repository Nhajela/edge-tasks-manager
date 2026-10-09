import { describe, expect, it } from "vitest";
import { forwardRequest, parseUpdate } from "../parse";
import type { TgChat, TgMessage, TgUpdate, TgUser } from "../types";

const ctx = { botUsername: "EtmBot", superadminUsername: "devadmin" };

const alice: TgUser = { id: 9100000001, first_name: "Alice", username: "alice" };
const bob: TgUser = { id: 9100000002, first_name: "Bob", username: "Bob" };
const noName: TgUser = { id: 9100000003, first_name: "Chitra" };
const bot: TgUser = { id: 9100000099, is_bot: true, first_name: "ETM", username: "etmbot" };
const otherBot: TgUser = { id: 9100000098, is_bot: true, first_name: "Other", username: "otherbot" };

const group: TgChat = { id: -1009100000000, type: "supergroup", title: "Ops" };
const dm: TgChat = { id: 9100000001, type: "private" };

let nextId = 100;
function msg(text: string | undefined, extra: Partial<TgMessage> = {}): TgMessage {
  return { message_id: nextId++, date: 1_700_000_000, chat: group, from: alice, ...(text !== undefined ? { text } : {}), ...extra };
}
const up = (message: TgMessage): TgUpdate => ({ update_id: 1, message });
const parse = (m: TgMessage) => parseUpdate(up(m), ctx);

const photo = [
  { file_id: "small", file_unique_id: "s", width: 90, height: 60 },
  { file_id: "big", file_unique_id: "b", width: 1280, height: 853, file_size: 99_000 },
  { file_id: "mid", file_unique_id: "m", width: 320, height: 213 },
];
const doc = { file_id: "doc1", file_unique_id: "d1", file_name: "quote.pdf", mime_type: "application/pdf", file_size: 1234 };

const fromAlice = { by: "user", user: alice };
const toBob = { by: "username", username: "bob" };
const toAdmin = { by: "superadmin" };

describe("parseUpdate: /request", () => {
  const cases: [string, () => TgMessage, object][] = [
    ["/request @bob body", () => msg("/request @bob fix the projector"),
      { kind: "request", via: "command", requester: fromAlice, assignee: toBob, body: "fix the projector", note: null, source: null }],
    ["/request no @ -> superadmin", () => msg("/request fix the projector"),
      { kind: "request", requester: fromAlice, assignee: toAdmin, body: "fix the projector" }],
    ["/request in a DM -> superadmin", () => msg("/request fix the projector", { chat: dm }),
      { kind: "request", assignee: toAdmin, body: "fix the projector", chat: dm }],
    ["/request@bot suffix (any case)", () => msg("/request@etmbot @bob fix it"),
      { kind: "request", assignee: toBob, body: "fix it" }],
    ["first @ is assignee, others stay in text", () => msg("/request @bob ask @carol about chairs"),
      { kind: "request", assignee: toBob, body: "ask @carol about chairs" }],
    ["@ mid-body is not the assignee", () => msg("/request ask @carol about chairs"),
      { kind: "request", assignee: toAdmin, body: "ask @carol about chairs" }],
    ["multiline body kept", () => msg("/request @bob line one\nline two"),
      { kind: "request", body: "line one\nline two" }],
    ["reply /request: requester = replied author, assignee = replier",
      () => msg("/request", { from: alice, reply_to_message: msg("the fan is broken", { from: bob }) }),
      { kind: "request", requester: { by: "user", user: bob }, assignee: fromAlice, body: "the fan is broken", note: null }],
    ["reply /request @bob: assignee bob, requester replied author, note kept",
      () => msg("/request @bob before 5pm please", { from: alice, reply_to_message: msg("chairs for hall", { from: noName }) }),
      { kind: "request", requester: { by: "user", user: noName }, assignee: toBob, body: "chairs for hall", note: "before 5pm please" }],
    ["reply /request uses replied caption and attaches its photo",
      () => msg("/request", { reply_to_message: msg(undefined, { message_id: 50, from: bob, caption: "this lamp", photo }) }),
      { kind: "request", body: "this lamp", attachments: [{ telegramFileId: "big", kind: "photo", messageId: 50, width: 1280, height: 853, size: 99_000 }] }],
    ["text_mention assignee (user without username)",
      () => msg("/request Chitra fix the tap", { entities: [{ type: "bot_command", offset: 0, length: 8 }, { type: "text_mention", offset: 9, length: 6, user: noName }] }),
      { kind: "request", assignee: { by: "user", user: noName }, body: "fix the tap" }],
    ["photo caption /request @bob attaches largest photo",
      () => msg(undefined, { message_id: 77, caption: "/request @bob hang this", photo }),
      { kind: "request", assignee: toBob, body: "hang this", attachments: [{ telegramFileId: "big", telegramFileUniqueId: "b", kind: "photo", messageId: 77 }] }],
    ["document caption /request attaches document",
      () => msg(undefined, { message_id: 78, caption: "/request pay this", document: doc }),
      { kind: "request", assignee: toAdmin, body: "pay this", attachments: [{ telegramFileId: "doc1", kind: "document", mime: "application/pdf", fileName: "quote.pdf", size: 1234, messageId: 78 }] }],
    ["/request @bob with no text and no reply -> prompt", () => msg("/request @bob"),
      { kind: "prompt", assignee: toBob }],
    ["bare /request -> help", () => msg("/request"), { kind: "help-mention" }],
    ["/request@otherbot -> ignore", () => msg("/request@otherbot fix it"), { kind: "ignore" }],
    ["reply /request to a forum topic root is not a reply",
      () => msg("/request fix it", { message_thread_id: 5, is_topic_message: true, reply_to_message: msg("Topic", { message_id: 5, from: bob }) }),
      { kind: "request", requester: fromAlice, assignee: toAdmin, body: "fix it", source: null }],
    ["reply /request in a plain supergroup carries message_thread_id = the chain root: still a reply",
      () => msg("/request", { from: alice, message_thread_id: 500, reply_to_message: msg("projector is broken", { message_id: 500, from: bob }) }),
      { kind: "request", requester: { by: "user", user: bob }, assignee: fromAlice, body: "projector is broken", source: { message_id: 500 } }],
    ["the topic-created service message is never a source",
      () => msg("/request fix it", { message_thread_id: 6, reply_to_message: msg(undefined, { message_id: 6, forum_topic_created: { name: "Ops" } }) }),
      { kind: "request", requester: fromAlice, body: "fix it", source: null }],
    ["reply /request to a bot message: the bot is never the requester",
      () => msg("/request @bob fix it", { reply_to_message: msg("📝 #12 for @bob", { from: bot }) }),
      { kind: "request", requester: fromAlice, assignee: toBob, body: "fix it", source: null }],
  ];
  it.each(cases)("%s", (_n, m, expected) => expect(parse(m())).toMatchObject(expected));
});

describe("parseUpdate: leading bot mention", () => {
  const cases: [string, () => TgMessage, object][] = [
    ["@bot @bob text", () => msg("@EtmBot @bob fix the projector"),
      { kind: "request", via: "mention", requester: fromAlice, assignee: toBob, body: "fix the projector" }],
    ["@bot text -> superadmin", () => msg("@etmbot fix the projector"),
      { kind: "request", via: "mention", assignee: toAdmin, body: "fix the projector" }],
    ["leading whitespace ok", () => msg("  @etmbot fix it"), { kind: "request", body: "fix it" }],
    ["@bot, punctuation after mention", () => msg("@etmbot, fix it"), { kind: "request", body: "fix it" }],
    ["@bot as reply -> from replied author to replier",
      () => msg("@etmbot", { from: alice, reply_to_message: msg("wifi is down", { from: bob }) }),
      { kind: "request", via: "mention", requester: { by: "user", user: bob }, assignee: fromAlice, body: "wifi is down", note: null }],
    ["@bot @bob as reply -> to bob",
      () => msg("@etmbot @bob", { from: alice, reply_to_message: msg("wifi is down", { from: noName }) }),
      { kind: "request", requester: { by: "user", user: noName }, assignee: toBob, body: "wifi is down" }],
    ["bare @bot -> help", () => msg("@etmbot"), { kind: "help-mention" }],
    ["@bot @bob no text -> prompt", () => msg("@etmbot @bob"), { kind: "prompt", assignee: toBob }],
    ["@bot mid-sentence -> ignore", () => msg("thanks @etmbot"), { kind: "ignore" }],
    ["longer username is not the bot", () => msg("@etmbot2 fix it"), { kind: "ignore" }],
    ["photo with caption @bot -> request with photo",
      () => msg(undefined, { caption: "@etmbot @bob fix this", photo }),
      { kind: "request", assignee: toBob, attachments: [{ telegramFileId: "big" }] }],
  ];
  it.each(cases)("%s", (_n, m, expected) => expect(parse(m())).toMatchObject(expected));
});

describe("parseUpdate: append, threads, replies to the bot", () => {
  const cases: [string, () => TgMessage, object][] = [
    ["/append as reply to a human message",
      () => { const r = msg("also the left speaker", { from: bob, message_id: 60 }); return msg("/append", { reply_to_message: r }); },
      { kind: "append", requestId: null, replyTo: { message_id: 60 }, payload: { message_id: 60 }, text: "also the left speaker" }],
    ["/add alias with explicit id", () => msg("/add 12", { reply_to_message: msg("more info", { from: bob }) }),
      { kind: "append", requestId: 12, text: "more info" }],
    ["/more #12 text, no reply", () => msg("/more #12 bring the extension cord"),
      { kind: "append", requestId: 12, replyTo: null, text: "bring the extension cord" }],
    ["/append text replying to the bot confirmation -> payload is the command",
      () => { const m = msg("/append need two", { reply_to_message: msg("📝 #12 for @bob", { from: bot, message_id: 61 }) }); return m; },
      { kind: "append", requestId: null, replyTo: { message_id: 61 }, text: "need two" }],
    ["/append without id or reply -> append with nothing (handler replies usage)", () => msg("/append"),
      { kind: "append", requestId: null, replyTo: null, text: "" }],
    ["/append reply to a photo attaches it",
      () => msg("/append", { reply_to_message: msg(undefined, { from: bob, photo, message_id: 62 }) }),
      { kind: "append", attachments: [{ telegramFileId: "big", messageId: 62 }] }],
    ["plain reply to the bot -> pending-reply",
      () => msg("tomorrow 10am", { reply_to_message: msg("What should @bob do?", { from: bot, message_id: 63 }) }),
      { kind: "pending-reply", botMessageId: 63, text: "tomorrow 10am" }],
    ["plain reply to a human -> thread candidate",
      () => msg("on it", { from: bob, reply_to_message: msg("hi", { message_id: 64 }) }),
      { kind: "thread", replyToMessageId: 64, text: "on it", from: bob }],
    ["photo reply without caption -> thread with attachment",
      () => msg(undefined, { photo, reply_to_message: msg("hi", { message_id: 65 }) }),
      { kind: "thread", replyToMessageId: 65, text: "", attachments: [{ telegramFileId: "big" }] }],
    ["reply to another bot -> thread candidate (not ours)",
      () => msg("ok", { reply_to_message: msg("hello", { from: otherBot, message_id: 66 }) }),
      { kind: "thread", replyToMessageId: 66 }],
    ["mid-sentence bot mention in a reply is still a thread reply",
      () => msg("thanks @etmbot", { reply_to_message: msg("done", { message_id: 67, from: bob }) }),
      { kind: "thread", replyToMessageId: 67 }],
    ["plain message, not a reply -> ignore", () => msg("hello all"), { kind: "ignore" }],
    ["plain message in a forum topic (implicit reply to topic root) -> ignore",
      () => msg("hello", { message_thread_id: 7, is_topic_message: true, reply_to_message: msg("Topic", { message_id: 7 }) }), { kind: "ignore" }],
    ["plain reply in a plain supergroup to the chain root -> thread",
      () => msg("I'll bring a spare", { message_thread_id: 68, reply_to_message: msg("hi", { message_id: 68, from: bob }) }),
      { kind: "thread", replyToMessageId: 68 }],
    ["plain reply to the bot's chain-root confirmation -> pending-reply",
      () => msg("need two", { message_thread_id: 69, reply_to_message: msg("📝 #12", { message_id: 69, from: bot }) }),
      { kind: "pending-reply", botMessageId: 69 }],
    ["sticker reply -> thread with a marker, so the chain keeps going",
      () => msg(undefined, { sticker: { file_id: "st" }, reply_to_message: msg("hi", { message_id: 70, from: bob }) } as Partial<TgMessage>),
      { kind: "thread", replyToMessageId: 70, text: "(sticker)" }],
    ["voice note reply -> thread with a marker",
      () => msg(undefined, { voice: { file_id: "v" }, reply_to_message: msg("hi", { message_id: 71, from: bob }) } as Partial<TgMessage>),
      { kind: "thread", text: "(voice note)" }],
    ["sticker reply to the bot -> thread with a marker (never an append), so the chain keeps going",
      () => msg(undefined, { sticker: { file_id: "st" }, reply_to_message: msg("📝 #12", { message_id: 72, from: bot }) } as Partial<TgMessage>),
      { kind: "thread", replyToMessageId: 72, text: "(sticker)" }],
    ["voice note reply to the bot's DM -> thread with a marker",
      () => msg(undefined, { chat: dm, voice: { file_id: "v" }, reply_to_message: msg("Alice asked you", { chat: dm, message_id: 73, from: bot }) } as Partial<TgMessage>),
      { kind: "thread", replyToMessageId: 73, text: "(voice note)" }],
  ];
  it.each(cases)("%s", (_n, m, expected) => expect(parse(m())).toMatchObject(expected));
});

describe("parseUpdate: list commands and /start", () => {
  const cases: [string, () => TgMessage, object][] = [
    ["/mine", () => msg("/mine"), { kind: "list", command: "mine", who: null, requestId: null }],
    ["/raised@bot", () => msg("/raised@EtmBot"), { kind: "list", command: "raised" }],
    ["/help", () => msg("/help"), { kind: "list", command: "help" }],
    ["/with @bob", () => msg("/with @Bob"), { kind: "list", command: "with", who: toBob }],
    ["/with as reply -> replied author", () => msg("/with", { reply_to_message: msg("x", { from: bob }) }),
      { kind: "list", command: "with", who: { by: "user", user: bob } }],
    ["/with nobody -> who null", () => msg("/with"), { kind: "list", command: "with", who: null }],
    ["/status 12", () => msg("/status 12"), { kind: "list", command: "status", requestId: 12 }],
    ["/start code", () => msg("/start abc123", { chat: dm }), { kind: "start", code: "abc123", chat: dm }],
    ["/start alone", () => msg("/start", { chat: dm }), { kind: "start", code: null }],
    ["/start in a group -> ignore (DM only)", () => msg("/start"), { kind: "ignore" }],
    ["unknown command -> ignore", () => msg("/frobnicate"), { kind: "ignore" }],
  ];
  it.each(cases)("%s", (_n, m, expected) => expect(parse(m())).toMatchObject(expected));
});

describe("parseUpdate: status commands", () => {
  const inThread = (text: string) => msg(text, { from: bob, reply_to_message: msg("Asha: on my way", { message_id: 80 }) });
  const cases: [string, () => TgMessage, object][] = [
    ["/done #12", () => msg("/done #12"), { kind: "status", status: "done", requestId: 12, replyToMessageId: null, note: null }],
    ["/done 12 note, no reply", () => msg("/done 12 projector fixed"), { kind: "status", requestId: 12, note: "projector fixed" }],
    ["/done without id or reply", () => msg("/done"), { kind: "status", status: "done", requestId: null, replyToMessageId: null }],
    ["/done note as a reply in a thread", () => inThread("/done projector fixed"),
      { kind: "status", status: "done", requestId: null, replyToMessageId: 80, note: "projector fixed", from: bob }],
    ["/done 3 spare cables as a reply: the number is the note", () => inThread("/done 3 spare cables"),
      { kind: "status", requestId: null, note: "3 spare cables" }],
    ["/done #12 as a reply: explicit id wins, the replied message rides along", () => inThread("/done #12"),
      { kind: "status", requestId: 12, replyToMessageId: 80, replied: { message: { message_id: 80 }, attachments: [] } }],
    ["/done with no reply: replied is null", () => msg("/done #12"), { kind: "status", replied: null }],
    ["/doing", () => inThread("/doing"), { kind: "status", status: "in_progress", note: null }],
    ["/waiting reason", () => inThread("/waiting parts from Panjim"), { kind: "status", status: "waiting", note: "parts from Panjim" }],
    ["/decline reason", () => inThread("/decline@EtmBot no budget"), { kind: "status", status: "declined", note: "no budget" }],
    ["/reopen", () => inThread("/reopen"), { kind: "status", status: "open" }],
    ["@bot done note as a reply", () => inThread("@etmbot done, projector fixed"),
      { kind: "status", status: "done", replyToMessageId: 80, note: "projector fixed" }],
    ["@bot on it as a reply to the bot's own message",
      () => msg("@EtmBot on it", { reply_to_message: msg("📝 #12 for @bob", { message_id: 81, from: bot }) }),
      { kind: "status", status: "in_progress", replyToMessageId: 81 }],
    ["photo captioned '/done all good' keeps the photo", () => msg(undefined, { from: bob, caption: "/done all good", photo, reply_to_message: msg("x", { message_id: 80 }) }),
      { kind: "status", status: "done", replyToMessageId: 80, note: "all good", attachments: [{ telegramFileId: "big", kind: "photo" }] }],
    ["@bot donate chairs is a request, not done", () => msg("@etmbot donate chairs"), { kind: "request", body: "donate chairs" }],
  ];
  it.each(cases)("%s", (_n, m, expected) => expect(parse(m())).toMatchObject(expected));
});

describe("parseUpdate: other updates and loop safety", () => {
  const cases: [string, TgUpdate, object][] = [
    ["edited_message -> ignore", { update_id: 1, edited_message: msg("/request fix it") }, { kind: "ignore" }],
    ["channel_post -> ignore", { update_id: 1, channel_post: msg("/request x") } as TgUpdate, { kind: "ignore" }],
    ["sticker-only -> ignore", up(msg(undefined, { sticker: { file_id: "st" } } as Partial<TgMessage>)), { kind: "ignore" }],
    ["no from -> ignore", up({ ...msg("/request fix it"), from: undefined }), { kind: "ignore" }],
    ["from a bot -> ignore", up(msg("/request fix it", { from: otherBot })), { kind: "ignore" }],
    ["channel chat -> ignore", up(msg("/request x", { chat: { id: -1009100000001, type: "channel" } })), { kind: "ignore" }],
    ["login callback", { update_id: 1, callback_query: { id: "cb1", from: alice, data: "login:abc", message: msg("Log in?") } },
      { kind: "login-confirm", code: "abc", callbackQueryId: "cb1", from: alice }],
    ["other callback -> ignore", { update_id: 1, callback_query: { id: "cb2", from: alice, data: "nope" } }, { kind: "ignore" }],
    ["my_chat_member -> membership",
      { update_id: 1, my_chat_member: { chat: group, from: alice, date: 1, old_chat_member: { status: "left", user: bot }, new_chat_member: { status: "member", user: bot } } },
      { kind: "membership", chat: group, from: alice, status: "member" }],
    ["empty update -> ignore", { update_id: 1 }, { kind: "ignore" }],
  ];
  it.each(cases)("%s", (_n, u, expected) => expect(parseUpdate(u, ctx)).toMatchObject(expected));

  it("request carries message, chat and from", () => {
    const m = msg("/request @bob x");
    expect(parse(m)).toMatchObject({ message: m, chat: group, from: alice });
  });

  it("reply /request attaches both command photo and source photo", () => {
    const r = parse(msg(undefined, { message_id: 90, caption: "/request", document: doc, reply_to_message: msg(undefined, { message_id: 91, from: bob, photo }) }));
    expect(r).toMatchObject({ kind: "request", attachments: [{ telegramFileId: "doc1", messageId: 90 }, { telegramFileId: "big", messageId: 91 }] });
  });
});

describe("parseUpdate: silent commands", () => {
  it("/new_request is /request, silent", () => {
    expect(parse(msg("/new_request @bob fix the projector"))).toMatchObject({ kind: "request", silent: true, assignee: toBob, body: "fix the projector" });
    expect(parse(msg("/request @bob fix it"))).not.toHaveProperty("silent", true);
  });
  it("/new_request_for_me on a reply: the replied author asks, the replier does it, even with an @ in the note", () => {
    expect(parse(msg("/new_request_for_me @bob by 5", { from: alice, reply_to_message: msg("the fan is broken", { from: noName }) }))).toMatchObject({
      kind: "request",
      silent: true,
      requester: { by: "user", user: noName },
      assignee: fromAlice,
      body: "the fan is broken",
      note: "@bob by 5",
    });
  });
  it("/new_request_for_me with text and no reply: a note to self", () => {
    expect(parse(msg("/new_request_for_me buy tape"))).toMatchObject({ kind: "request", silent: true, requester: fromAlice, assignee: fromAlice, body: "buy tape" });
  });
  it("/log keeps the replied human message; a reply to the bot or no reply has no source", () => {
    const fan = msg("the fan is broken", { from: bob });
    expect(parse(msg("/log", { reply_to_message: fan }))).toMatchObject({ kind: "log", source: fan });
    expect(parse(msg("/log", { reply_to_message: msg("📝 #3", { from: bot }) }))).toMatchObject({ kind: "log", source: null });
    expect(parse(msg("/log"))).toMatchObject({ kind: "log", source: null });
  });
});

describe("parseUpdate: /note", () => {
  it("in a thread the text is the note (even a leading number); /note 12 text from anywhere", () => {
    const r = msg("photo", { message_id: 40 });
    expect(parse(msg("/note 3 spare cables in the van", { reply_to_message: r }))).toMatchObject({ kind: "note", requestId: null, replyToMessageId: 40, text: "3 spare cables in the van" });
    expect(parse(msg("/note #12 call the vendor"))).toMatchObject({ kind: "note", requestId: 12, replyToMessageId: null, text: "call the vendor" });
  });
});

describe("parseUpdate: forwards to the bot's DM", () => {
  const fwd = (origin: object, extra: Partial<TgMessage> = {}) => msg("can we have a place to message people", { chat: dm, forward_origin: origin, ...extra } as Partial<TgMessage>);
  it("a forward in private asks first; forwards in groups are ignored", () => {
    expect(parse(fwd({ type: "user", date: 1, sender_user: bob }))).toMatchObject({ kind: "forward" });
    expect(parse(msg("hi", { forward_origin: { type: "user", date: 1, sender_user: bob } } as Partial<TgMessage>)).kind).toBe("ignore");
  });
  it("forwardRequest: who it's from, the text, the photo", () => {
    expect(forwardRequest(fwd({ type: "user", date: 1, sender_user: bob }))).toMatchObject({ author: bob, name: "Bob (@Bob)", body: "can we have a place to message people" });
    // the author hides forwards: only a name, so the forwarder becomes the requester
    expect(forwardRequest(fwd({ type: "hidden_user", date: 1, sender_user_name: "Lucy Chen" }))).toMatchObject({ author: null, name: "Lucy Chen", body: "Lucy Chen: can we have a place to message people" });
    expect(forwardRequest(fwd({ type: "user", date: 1, sender_user: bob }, { text: undefined, caption: "this lamp", photo }))).toMatchObject({ body: "this lamp", attachments: [{ telegramFileId: "big" }] });
  });
});
