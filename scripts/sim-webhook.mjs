// Dev only: POST realistic fake Telegram updates to a local /api/telegram, so bot flows can be tried without Telegram.
// Usage: node scripts/sim-webhook.mjs <baseUrl> <scenario> [requestId]
//   e.g. node --env-file=.env.local scripts/sim-webhook.mjs http://localhost:3101 request-at
// Uses the seeded people (scripts/seed-dev.mjs, fake telegram ids 91000000xx). Bot replies are read back from the dev
// outbox ($TMP/edge-tasks-outbox.jsonl), which is where a non-production server records its fake sent-message ids.
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const BOT = (process.env.TELEGRAM_BOT_USERNAME || "EdgeTasksBot").replace(/^@/, "");
export const PEOPLE = {
  asha: { id: 9100000002, is_bot: false, first_name: "Asha", username: "asha" },
  ben: { id: 9100000003, is_bot: false, first_name: "Ben", username: "ben" },
  chitra: { id: 9100000004, is_bot: false, first_name: "Chitra", username: "chitra" },
  farid: { id: 9100000007, is_bot: false, first_name: "Farid" },
};
export const CHAT = { id: -1009100000002, type: "supergroup", title: "Edge City Sim" };

// Unique per run so Telegram-style dedupe on (chat_id, message_id) never swallows a re-run. Milliseconds, not
// seconds: back-to-back runs (pnpm e2e) start within the same second and used to reuse each other's ids.
let nextId = Date.now() % 2_000_000_000;

/** Entities for every leading /command, @mention and text_mention token, the way Telegram computes them (UTF-16). */
function entitiesFor(text, textMentions = {}) {
  const out = [];
  for (const m of text.matchAll(/(^\/[a-z]+(?:@\w+)?)|(@\w+)/g)) {
    if (m[1]) out.push({ type: "bot_command", offset: m.index, length: m[1].length });
    else out.push({ type: "mention", offset: m.index, length: m[2].length });
  }
  for (const [name, user] of Object.entries(textMentions)) {
    const i = text.indexOf(name);
    if (i >= 0) out.push({ type: "text_mention", offset: i, length: name.length, user });
  }
  return out.sort((a, b) => a.offset - b.offset);
}

/** A group message from `from`. Options: replyTo (a message), photo (true), textMentions ({ "Farid": user }). */
export function msg(from, text, { replyTo, photo, textMentions } = {}) {
  const m = { message_id: nextId++, date: Math.floor(Date.now() / 1000), chat: CHAT, from };
  const entities = text ? entitiesFor(text, textMentions) : [];
  if (photo) {
    const u = `sim${m.message_id}`;
    m.photo = [
      { file_id: `AgACsim-${u}-s`, file_unique_id: `${u}s`, width: 90, height: 67, file_size: 1400 },
      { file_id: `AgACsim-${u}-m`, file_unique_id: `${u}m`, width: 320, height: 240, file_size: 18000 },
      { file_id: `AgACsim-${u}-x`, file_unique_id: `${u}x`, width: 1280, height: 960, file_size: 160000 },
    ];
    if (text) m.caption = text;
    if (entities.length) m.caption_entities = entities;
  } else {
    m.text = text;
    if (entities.length) m.entities = entities;
  }
  if (replyTo) m.reply_to_message = replyTo;
  return m;
}

/** The bot's own message as Telegram would embed it in reply_to_message. */
export const botMsg = (reply) => ({
  message_id: reply.messageId,
  date: Math.floor(Date.now() / 1000),
  chat: CHAT,
  from: { id: 9100000099, is_bot: true, first_name: "Edge Tasks", username: BOT },
  text: reply.text,
});

const requestIdOf = (reply) => Number(/#(\d+)/.exec(reply.text)?.[1] ?? NaN);

/**
 * Each scenario gets `sim`: send(message) posts it as an update; reply(message) returns the bot's reply to it
 * ({messageId, text}) from the outbox. Scenarios return nothing; the runner prints what happened.
 */
export const SCENARIOS = {
  /** /request @ben <text> from Asha */
  "request-at": async (sim) => {
    await sim.send(msg(PEOPLE.asha, "/request @ben fix the projector in the dome before the 6pm talk"));
  },
  /** Ben posts a problem; Asha replies with /request: requester Ben, assignee Asha (the "give this to me" case). */
  "reply-request": async (sim) => {
    const ask = msg(PEOPLE.ben, "the wifi in villa 3 keeps dropping every few minutes");
    await sim.send(msg(PEOPLE.asha, "/request", { replyTo: ask }));
    // and assigning someone else from a reply, with a note
    const ask2 = msg(PEOPLE.chitra, "can someone get more drinking water to the yoga deck?");
    await sim.send(msg(PEOPLE.asha, `/request@${BOT} @ben two 20L cans please`, { replyTo: ask2 }));
  },
  /** Leading bot mention, to @ben, to the organiser, to a user without a username; a late mention is ignored. */
  mention: async (sim) => {
    await sim.send(msg(PEOPLE.asha, `@${BOT} @ben bring extension cords to the main hall`));
    await sim.send(msg(PEOPLE.chitra, `@${BOT} the beach shack needs a bin`));
    await sim.send(msg(PEOPLE.asha, `@${BOT} Farid can you check the generator fuel`, { textMentions: { Farid: PEOPLE.farid } }));
    await sim.send(msg(PEOPLE.ben, `thanks @${BOT}`));
  },
  /** `@bot @ben` alone -> bot asks "What should @ben do?" -> Asha replies to that prompt with the details. */
  "mention-pending": async (sim) => {
    const ping = msg(PEOPLE.asha, `@${BOT} @ben`);
    await sim.send(ping);
    const prompt = await sim.reply(ping);
    await sim.send(msg(PEOPLE.asha, "set up 40 chairs in the dome for tonight", { replyTo: botMsg(prompt) }));
  },
  /** Create, /append a later message by the requester, /append <id> explicitly, plain reply to the confirmation. */
  append: async (sim) => {
    const cmd = msg(PEOPLE.asha, "/request @ben the kitchen fridge is not cooling");
    await sim.send(cmd);
    const conf = await sim.reply(cmd);
    const later = msg(PEOPLE.asha, "also the freezer door doesn't close properly");
    await sim.send(msg(PEOPLE.ben, "/append", { replyTo: later }));
    const more = msg(PEOPLE.chitra, "the milk went off this morning too");
    await sim.send(msg(PEOPLE.asha, `/add ${requestIdOf(conf)}`, { replyTo: more }));
    await sim.send(msg(PEOPLE.asha, "it's the one by the back door", { replyTo: botMsg(conf) }));
  },
  /** Photo with a /request caption, then /request as a reply to someone else's photo. */
  photo: async (sim) => {
    await sim.send(msg(PEOPLE.asha, "/request @ben the shelf in the library fell off the wall", { photo: true }));
    const pic = msg(PEOPLE.chitra, "look at this leak under the sink", { photo: true });
    await sim.send(msg(PEOPLE.ben, "/request", { replyTo: pic }));
  },
  /** SPEC example: confirmation -> Asha replies -> Ben replies to Asha -> Asha replies to Ben -> Chitra replies to Ben. */
  "thread-chain": async (sim) => {
    const cmd = msg(PEOPLE.asha, "/request @ben fix the leaking tap in the co-working space");
    await sim.send(cmd);
    const conf = await sim.reply(cmd);
    const a1 = msg(PEOPLE.asha, "it's the one on the left, near the window", { replyTo: botMsg(conf) });
    await sim.send(a1);
    const b1 = msg(PEOPLE.ben, "got it, do we have a spare washer?", { replyTo: a1 });
    await sim.send(b1);
    await sim.send(msg(PEOPLE.asha, "check the toolbox under the stairs", { replyTo: b1 }));
    await sim.send(msg(PEOPLE.chitra, "I took the last one yesterday, sorry! hardware shop in Mandrem has them", { replyTo: b1 }));
  },
  /** Every list command. Pass a request id as the 3rd argument for /status (default 1). */
  list: async (sim, id = 1) => {
    for (const t of ["/mine", "/raised", "/with @ben", `/status ${id}`, `/status@${BOT} ${id}`, "/status", "/help"])
      await sim.send(msg(PEOPLE.asha, t));
  },
  /** Create as Asha for Ben, Ben marks it done. With a request id argument, Ben just does /done <id>. */
  done: async (sim, id) => {
    if (!id) {
      const cmd = msg(PEOPLE.asha, "/request @ben return the borrowed speaker to the cafe");
      await sim.send(cmd);
      id = requestIdOf(await sim.reply(cmd));
    }
    await sim.send(msg(PEOPLE.ben, `/done ${id}`));
  },
  /** Round 2: a chain 3 deep under the confirmation, then Ben replies `/done <note>` to the deepest message (no id). */
  "done-in-thread": async (sim) => {
    const cmd = msg(PEOPLE.asha, "/request @ben fix the wobbly table in the cafe");
    await sim.send(cmd);
    const conf = await sim.reply(cmd);
    const a1 = msg(PEOPLE.asha, "the one by the window", { replyTo: botMsg(conf) });
    await sim.send(a1);
    const b1 = msg(PEOPLE.ben, "needs a shim, I'll cut one", { replyTo: a1 });
    await sim.send(b1);
    const a2 = msg(PEOPLE.asha, "great, thanks!", { replyTo: b1 });
    await sim.send(a2);
    await sim.send(msg(PEOPLE.ben, "/done shimmed both legs, rock solid now", { replyTo: a2 }));
  },
  /** Round 2: Ben's photo with caption `/done <note>` replying to the confirmation: the photo is the deliverable. */
  "done-with-photo": async (sim) => {
    const cmd = msg(PEOPLE.asha, "/request @ben put up a sign for the quiet room");
    await sim.send(cmd);
    const conf = await sim.reply(cmd);
    await sim.send(msg(PEOPLE.ben, "/done sign is up by the door", { photo: true, replyTo: botMsg(conf) }));
  },
  /** Round 2: Ben posts the work (photo) in the thread, the requester Asha closes it on his behalf replying to it. */
  "close-on-behalf": async (sim) => {
    const cmd = msg(PEOPLE.asha, "/request @ben print 30 copies of the week-2 schedule");
    await sim.send(cmd);
    const conf = await sim.reply(cmd);
    const work = msg(PEOPLE.ben, "printed, pinned one on the noticeboard", { photo: true, replyTo: botMsg(conf) });
    await sim.send(work);
    await sim.send(msg(PEOPLE.asha, "/done all 30 picked up, thanks Ben", { replyTo: work }));
  },
  /** Round 2: the assignee writes a bare "done" reply: the bot asks "Mark #N done?" (button) instead of closing it. */
  "bare-done-assignee": async (sim) => {
    const cmd = msg(PEOPLE.asha, "/request @ben refill the water dispenser in the dome");
    await sim.send(cmd);
    const conf = await sim.reply(cmd);
    await sim.send(msg(PEOPLE.ben, "done", { replyTo: botMsg(conf) }));
  },
};

const OUTBOX = join(tmpdir(), "edge-tasks-outbox.jsonl");

/** The bot's reply to `message` from the dev outbox (waits up to 3s; the webhook sends replies before it returns). */
async function readReply(message) {
  for (let i = 0; i < 30; i++) {
    const lines = (await readFile(OUTBOX, "utf8").catch(() => "")).trim().split("\n").reverse();
    for (const l of lines) {
      const e = JSON.parse(l || "{}");
      if (String(e.chatId) === String(message.chat.id) && e.replyTo === message.message_id && e.messageId)
        return { messageId: e.messageId, text: e.text };
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No bot reply to message ${message.message_id} in ${OUTBOX}. Is the server a dev server (not NODE_ENV=production)?`);
}

async function main() {
  const [base, name, arg] = process.argv.slice(2);
  const scenario = SCENARIOS[name];
  if (!base || !scenario)
    throw new Error(`usage: node scripts/sim-webhook.mjs <baseUrl> <scenario> [requestId]\nscenarios: ${Object.keys(SCENARIOS).join(", ")}`);
  // fake updates write fake rows: never aim this at a deployed app
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(base)) throw new Error("Refusing: sim-webhook only posts to localhost");
  const url = new URL("/api/telegram", base).toString();
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  let updateId = nextId * 10;
  const sim = {
    async send(message) {
      const update = { update_id: updateId++, message };
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}) },
        body: JSON.stringify(update),
      });
      const who = message.from.username ?? message.from.first_name;
      const re = message.reply_to_message ? ` (reply to ${message.reply_to_message.message_id})` : "";
      console.log(`-> ${message.message_id} ${who}${re}: ${message.text ?? `[photo] ${message.caption ?? ""}`}`);
      console.log(`   ${res.status} ${(await res.text()).slice(0, 200)}`);
    },
    async reply(message) {
      const r = await readReply(message);
      console.log(`<- bot ${r.messageId}: ${r.text.split("\n")[0]}`);
      return r;
    },
  };
  await scenario(sim, arg ? Number(arg) : undefined);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
