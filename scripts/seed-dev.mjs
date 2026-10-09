// Dev only: fill a local dev database with fake people and requests, all written through src/services (so every
// row has its audit_log entry). Safe to re-run: Telegram message ids dedupe, so a second run adds nothing.
// Usage: DATABASE_URL=postgres://postgres@localhost:5545/<db> node scripts/seed-dev.mjs
import { register as registerCjs } from "tsx/cjs/api";
import { register } from "tsx/esm/api";

const url = process.env.DATABASE_URL;
if (!url || !/localhost|127\.0\.0\.1/.test(url)) throw new Error("Refusing: seed-dev only writes to a local database");
register(); // TypeScript (ESM + CJS: package.json has no "type": "module")
registerCjs(); // + tsconfig "@/..." paths for the imports below

const { createDb } = await import("../src/db/index.ts");
const people = await import("../src/services/people.ts");
const requests = await import("../src/services/requests.ts");
const { personActor, systemActor } = await import("../src/lib/actor.ts");

const db = createDb(url);
const sys = systemActor("seed");

// fake telegram ids 91000000xx: never real users. devadmin is the admin when run with SUPERADMIN_USERNAME=devadmin.
const FOLK = [
  ["devadmin", "Dev Admin"],
  ["asha", "Asha"],
  ["ben", "Ben"],
  ["chitra", "Chitra"],
  ["dev", "Dev"],
  ["esha", "Esha"],
  [null, "Farid"], // no username: shown by first name, no /with link
];
const P = {};
for (const [i, [username, firstName]] of FOLK.entries())
  P[username ?? "farid"] = await people.upsertFromTelegram(db, sys, {
    telegramId: 9100000001 + i,
    username,
    firstName,
    startedBot: i % 2 === 0,
  });
// mentioned before ever talking to the bot: username only
P.gopal = await people.upsertFromTelegram(db, sys, { username: "gopal" });

const CHAT = -1009100000001;
const as = (p) => personActor(p, { via: "telegram", isAdmin: false });
const hours = (h) => new Date(Date.now() + h * 3600_000);
// due on an IST calendar day (the grouping's day convention): 0 = today, 1 = tomorrow, -1 = yesterday
const IST = 5.5 * 3600_000;
const istDay = (offset, h = 12, m = 0) => {
  const d = new Date(Date.now() + IST);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + offset, h, m) - IST);
};
const due = {
  overdue: istDay(-1),
  today: new Date(Math.max(istDay(0, 23, 30).getTime(), Date.now() + 60_000)), // late tonight, never already past
  tomorrow: istDay(1),
  later: istDay(4),
};
let msg = 1000;

/**
 * [requester, assignee, body, status, extra]. Every item is seen by its assignee unless `fresh` (stays in "New").
 * Covers every bucket for asha and ben: inbox New/Act/Upcoming/Waiting/Done, raised Overdue/Active/Waiting/Recently done.
 */
const SPECS = [
  ["asha", "ben", "Can you get 20 extra chairs to the main hall before the talk tonight", "open", { priority: "high", dueAt: due.today }],
  ["ben", "asha", "Projector in the dome flickers, please check the HDMI cable", "in_progress", { custom: "ordering a new cable from Panjim" }],
  ["chitra", "devadmin", "Need a list of everyone arriving on the 14th for airport pickups", "open", { dueAt: hours(-20) }],
  ["dev", "esha", "Book the beach slot for sunrise yoga on Saturday", "waiting", { custom: "waiting on Riva staff" }],
  ["esha", "dev", "Print 50 name badges for the builders track", "done"],
  ["asha", "chitra", "Ask the kitchen about vegan options for Friday dinner", "open", { priority: "urgent", dueAt: due.overdue }],
  ["farid", "asha", "Wifi in cottage 12 keeps dropping", "open", { photo: true, fresh: true }],
  ["devadmin", "ben", "Set up the sound system for the opening night", "done"],
  ["ben", "gopal", "Pick up the welcome kits from the courier office", "open", { dueAt: hours(30) }],
  ["chitra", "esha", "Find two more volunteers for the registration desk", "declined"],
  ["dev", "asha", "Share the photos from the hackathon kickoff", "open", { photo: true, priority: "low" }],
  ["esha", "devadmin", "Reimburse my scooter rental receipts", "in_progress"],
  ["asha", "dev", "Fix the leaking tap in the co-working space", "in_progress", { thread: true }],
  ["ben", "chitra", "Draft the schedule for the second week", "waiting"],
  ["devadmin", "asha", "Collect feedback forms after the panel", "open", { dueAt: due.later }],
  // round 2: due spread, waiting with a reason, a fresh one, done ones, and the delivered one
  ["chitra", "ben", "Return the projector screen we borrowed from Riva", "open", { dueAt: due.overdue }],
  ["devadmin", "ben", "Collect the drone from the customs office in Panjim", "in_progress", { dueAt: due.tomorrow }],
  ["esha", "ben", "Build the stage for closing night", "open", { dueAt: due.later, priority: "high" }],
  ["chitra", "ben", "Order 10 more bean bags for the dome", "waiting", { custom: "waiting on the supplier quote" }],
  ["dev", "ben", "Check the generator before the beach party", "open", { fresh: true, priority: "urgent" }],
  ["chitra", "asha", "Confirm the bus for the Anjuna market trip", "waiting", { custom: "waiting on the bus company" }],
  ["esha", "asha", "Collect the lanyards from the print shop", "done"],
  ["asha", "esha", "Check if the dome can host 80 people for the demo day", "waiting", { custom: "asking the fire marshal" }],
  ["asha", "ben", "Send me the best photos from opening night for the newsletter", "open", { delivered: true }],
];

for (const [from, to, body, status, x = {}] of SPECS) {
  const id = ++msg;
  const { request, duplicate } = await requests.create(db, as(P[from]), {
    requesterId: P[from].id,
    assigneeId: P[to].id,
    body,
    priority: x.priority,
    dueAt: x.dueAt,
    chatId: CHAT,
    chatTitle: "ECI Volunteers (dev)",
    messages: [{ messageId: id, fromId: P[from].id, text: body, link: `https://t.me/c/9100000001/${id}` }],
    attachments: x.photo
      ? [{ messageId: id, telegramFileId: `dev-file-${id}`, telegramFileUniqueId: `dev-u-${id}`, kind: "photo", width: 800, height: 600 }]
      : [],
  });
  if (duplicate) continue;
  const assignee = as(P[to]);
  if (!x.fresh) await requests.markSeen(db, assignee, request.id);
  if (status !== "open") await requests.setStatus(db, assignee, request.id, { status, customStatus: x.custom });
  if (status === "done") await requests.comment(db, assignee, request.id, { text: "All sorted!", notify: false });
  const thread = (who, messageId, replyToMessageId, text, attachments) =>
    requests.addThreadMessage(db, as(P[who]), {
      requestId: request.id,
      chatId: CHAT,
      messageId,
      replyToMessageId,
      fromId: P[who].id,
      text,
      link: `https://t.me/c/9100000001/${messageId}`,
      attachments,
    });
  if (x.thread) {
    // the SPEC reply chain: bot confirmation <- Asha <- Ben <- Asha, and Chitra answering Ben
    const confirm = id + 100;
    await requests.setBotConfirmation(db, sys, request.id, { chatId: CHAT, messageId: confirm });
    await thread("asha", confirm + 1, confirm, "Plumber said he can come after 4pm");
    await thread("ben", confirm + 2, confirm + 1, "I can let him in, I'm there all afternoon");
    await thread("asha", confirm + 3, confirm + 2, "Perfect, thanks Ben");
    await thread("chitra", confirm + 4, confirm + 2, "There's a spare key at reception too");
    await requests.append(db, as(P.asha), {
      requestId: request.id,
      chatId: CHAT,
      messageId: confirm + 5,
      fromId: P.asha.id,
      text: "It's the tap by the window, not the kitchen one",
    });
  }
  if (x.delivered) {
    // Ben posts the photos in the thread; Asha (the requester) closes it on his behalf with `/done`, replying to them
    const confirm = id + 100;
    await requests.setBotConfirmation(db, sys, request.id, { chatId: CHAT, messageId: confirm });
    const work = confirm + 1;
    await thread("ben", work, confirm, "Here are my 3 favourites, the rest are in the shared drive", [
      { messageId: work, telegramFileId: `dev-file-${work}`, telegramFileUniqueId: `dev-u-${work}`, kind: "photo", width: 1280, height: 960 },
    ]);
    const { messages } = await requests.getDetail(db, as(P.asha), request.id);
    const workRow = messages.find((m) => m.messageId === work);
    await requests.setStatus(db, as(P.asha), request.id, {
      status: "done",
      note: "Perfect, using these",
      message: { chatId: CHAT, messageId: confirm + 2, replyToMessageId: work, fromId: P.asha.id, text: "/done Perfect, using these" },
      result: { note: "3 photos picked for the newsletter, 40 more in the shared drive", messageId: workRow.id },
    });
  }
}
console.log(`seeded ${Object.keys(P).length} people, ${SPECS.length} requests into ${new URL(url).pathname.slice(1)}`);
console.log("log in: node scripts/dev-login.mjs asha   (admin: devadmin, with SUPERADMIN_USERNAME=devadmin SUPERADMIN_TELEGRAM_ID=)");
process.exit(0);
