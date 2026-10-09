/**
 * The tutorial as data. Single source for the landing page, the bot's /help (`helpLines`) and the README's
 * "Bot commands" table (`commandsMarkdown`, written by `node scripts/readme-commands.mjs`).
 * `@bot` in any string is a placeholder for the real bot username; render through `withBot`.
 * No imports: the README script loads this file with plain Node.
 */

export type Bubble = {
  from: "you" | "them" | "bot";
  text: string;
  /** Quoted message this one replies to. */
  reply?: string;
  /** Sender shown above the bubble (them/bot only). */
  name?: string;
};

export type Step = {
  title: string;
  body: string;
  chat: Bubble[];
  /** Tucked-away detail, e.g. for group admins. */
  aside?: { label: string; text: string };
};

/** `help` = the short line for the bot's /help; entries without it are left out of /help. */
export type Entry = { term: string; meaning: string; example?: string; help?: string };

export const withBot = (s: string, bot: string) => s.replaceAll("@bot", `@${bot}`);

const CONFIRM = "📝 #12 for @bob: Fix the projector";

export const STEPS: Step[] = [
  {
    title: "Add @bot to your group",
    body: "Any group works. People can also message the bot directly.",
    chat: [{ from: "them", name: "Telegram", text: "Asha added @bot to the group" }],
    aside: {
      label: "Group admins: one setting",
      text:
        "Commands and mentions always reach the bot. For it to also see plain replies in a thread, make it a group admin, or in BotFather run /setprivacy and choose Disable.",
    },
  },
  {
    title: "Ask someone for something",
    body: "Type the command, or just mention the bot first. No @name means it goes to the organiser.",
    chat: [
      { from: "you", text: "/request @bob fix the projector" },
      { from: "bot", name: "Edge Tasks", text: CONFIRM },
    ],
  },
  {
    title: "Turn someone's message into a request",
    body: "Reply to their message with /request and you take it on. Add @bob to hand it to bob instead.",
    chat: [
      { from: "them", name: "Asha", text: "can someone grab chairs for the talk?" },
      { from: "you", reply: "can someone grab chairs for the talk?", text: "/request" },
      { from: "bot", name: "Edge Tasks", text: "📝 #13 for @you: Grab chairs for the talk" },
    ],
  },
  {
    title: "Talk it out",
    body: "Reply to the bot's confirmation, or to any reply under it, at any depth. It all becomes the request's thread on the web. No command needed, and nobody gets pinged.",
    chat: [
      { from: "them", name: "Bob", reply: CONFIRM, text: "Which room?" },
      { from: "you", reply: "Which room?", text: "Dome, back wall" },
    ],
  },
  {
    title: "Add to the request itself",
    body: "Thread replies don't change what was asked. To add to the request, reply to a message with /append: it joins that person's latest open request.",
    chat: [
      { from: "them", name: "Asha", text: "and the HDMI cable is missing" },
      { from: "you", reply: "and the HDMI cable is missing", text: "/append" },
      { from: "bot", name: "Edge Tasks", text: "➕ Added to #12" },
    ],
  },
  {
    title: "Update from anywhere in the thread",
    body: "Reply to any message of the request with a status command, or mention the bot. No #12 needed. The requester is told, and the thread shows a small status line.",
    chat: [
      { from: "them", name: "Bob", reply: "Dome, back wall", text: "@bot on it" },
      { from: "them", name: "Bob", reply: "Dome, back wall", text: "/waiting cable on order" },
      { from: "bot", name: "Edge Tasks", text: "#12 is now cable on order: Fix the projector" },
    ],
  },
  {
    title: "Deliver it",
    body: "Finish with /done and a note. Send it with a photo, or reply to the photo, and that becomes the deliverable: a ✅ Delivered card at the top of the request, and the requester gets the photo.",
    chat: [
      { from: "them", name: "Bob", reply: "Which room?", text: "📷 [photo] new bulb in" },
      { from: "them", name: "Bob", reply: "📷 [photo] new bulb in", text: "/done new bulb fitted" },
      { from: "bot", name: "Edge Tasks", text: "✅ #12 is done: Fix the projector" },
    ],
  },
  {
    title: "Close it for them",
    body: "Bob fixed it but forgot to close it? As the requester you can /done or /decline it yourself (admins can too). It says closed on behalf of @bob, and Bob is the one told.",
    chat: [
      { from: "you", reply: CONFIRM, text: "/done works now, thanks" },
      { from: "bot", name: "Edge Tasks", text: "✅ #12 is done: Fix the projector" },
    ],
  },
  {
    title: "See everything, sorted by what to do",
    body: "Log in with Telegram. To me sorts what people asked of you into New, Act, Upcoming, Waiting and Done. I asked shows what you asked of others: Overdue first, then Active, Waiting, Recently done, and who has your requests. The two are never mixed. In Telegram, /mine and /raised do the same.",
    chat: [
      { from: "you", text: "/mine" },
      { from: "bot", name: "Edge Tasks", text: "For you (1 open)\n\nAct (1)\n#13 Grab chairs for the talk — Open · due today" },
    ],
  },
  {
    title: "Optional: connect your AI agent",
    body: "In Settings, create an MCP token and paste the config into Claude Code or claude.ai. Your agent can then read and update your requests as you.",
    chat: [],
  },
];

export const COMMAND_ENTRIES: Entry[] = [
  {
    term: "/request @bob <what>",
    meaning: "Ask @bob for something. Without an @name it goes to the organiser. The bot confirms with “📝 #12 for @bob”.",
    example: "/request @bob fix the projector",
    help: "ask @bob (no @name: the organiser)",
  },
  {
    term: "@bot @bob <what>",
    meaning: "Same as /request. The bot mention must be the first thing in the message; a “thanks @bot” later in a sentence does nothing.",
    example: "@bot @bob fix the projector",
    help: "same, by mentioning me first",
  },
  {
    term: "@bot @bob (no text)",
    meaning: "The bot asks “What should @bob do? Reply to this message with the details.” Your reply becomes the request. Expires in an hour.",
    example: "@bot @bob",
  },
  {
    term: "Reply + /request",
    meaning: "Turns their message into a request from them to you. Add @bob to hand it to bob; extra text becomes a note. Photos come along.",
    example: "/request @bob",
    help: "reply to a message: you take it on (add @bob to hand it on)",
  },
  {
    term: "/append (/add, /more)",
    meaning:
      "Reply to a message to add it to that person's latest open request. /append 12 picks a request. Replying to the bot's “#12” message, /append <text> adds the text. The only way to change what was asked; plain replies go to the thread.",
    example: "/append 12",
    help: "reply to a message: add it to their latest request",
  },
  {
    term: "/log",
    meaning:
      "Quiet. Reply to someone's message: already a request, it tells you its number; a reply to a request's message, it joins that thread; anything else becomes a request from them to you. Nothing is posted in the group and nobody is pinged: your /log is deleted (if the bot is a group admin) and only you get a DM. Later updates notify as usual.",
    example: "/log",
    help: "reply to a message: quietly track it for you, only you are told",
  },
  {
    term: "/new_request, /new_request_for_me",
    meaning:
      "Quiet versions of /request: same rules, but no group reply and no DM to anyone at creation, only a DM to you. /new_request_for_me always gives it to you, even with an @name in the note.",
    example: "/new_request @bob chairs for the dome",
    help: "like /request, but quiet (…_for_me: it's yours)",
  },
  {
    term: "Forward to the bot",
    meaning:
      "Forward any message to the bot in private: it shows who it's from and asks “new request, or add to one?”, listing your open requests with that person first. A new one is a quiet request from its author to you. Handy for messages /log can't see (sent before the bot joined a group, or in another chat). If the author hides forwards, you're the requester and their name starts the text.",
    help: "forward me a message in private: new request or add to one, you pick",
  },
  {
    term: "/doing",
    meaning: "Mark Doing. Reply to any message of the request (no id needed), or give the id. “@bot on it” does the same.",
    example: "/doing 12",
    help: "you're on it",
  },
  {
    term: "/waiting <reason>",
    meaning: "Mark Waiting; the reason becomes the label people see.",
    example: "/waiting cable on order",
    help: "blocked; the reason is the label",
  },
  {
    term: "/done <note>",
    meaning:
      "Mark Done; the requester is told. Reply in the thread, or /done 12 <note> from anywhere. The note is the deliverable; send it with a photo or file, or reply to one, and that message is delivered too. The requester or an admin can close it on the assignee's behalf; then the assignee is told.",
    example: "/done new bulb fitted",
    help: "finished; add a photo, or reply to one, to deliver it",
  },
  {
    term: "@bot done <note>",
    meaning: "Same as /done, by mention. “@bot on it” is /doing.",
    example: "@bot done new bulb fitted",
    help: "same as /done (and @bot on it = /doing)",
  },
  {
    term: "done (plain reply)",
    meaning: "Just a thread message; people say “done” in conversation. If the assignee replies exactly “done” or “✅”, the bot offers a one-tap “Mark #12 done?” button.",
  },
  {
    term: "/decline <reason>",
    meaning: "Say no, with a reason. The requester is told (or the assignee, if the requester declines it for them).",
    example: "/decline not my area, try @asha",
    help: "say no, with a reason",
  },
  { term: "/reopen", meaning: "Back to Open. Clears the ✅ Delivered card; the old messages stay in the thread.", example: "/reopen 12", help: "back to Open" },
  { term: "/mine", meaning: "Open requests for you: Act, then New, then Upcoming. Max 10.", example: "/mine", help: "open requests for you" },
  { term: "/raised", meaning: "Open requests you asked for, overdue first.", example: "/raised", help: "open requests you asked for" },
  {
    term: "/with @bob",
    meaning: "Everything open between you and @bob, in two blocks: what @bob asked you, then what you asked @bob.",
    example: "/with @bob",
    help: "open requests between you and @bob",
  },
  { term: "/status 12", meaning: "One request: title, status, due, who asked whom.", example: "/status 12", help: "one request" },
  { term: "/help", meaning: "This list, inside Telegram.", example: "/help" },
  { term: "/start", meaning: "Message the bot once so it can message you back. Also finishes a web login.", example: "/start" },
];

export const WORD_ENTRIES: Entry[] = [
  { term: "Request", meaning: "One ask, numbered like #12. It has a title, a requester, an assignee, a status and a thread." },
  { term: "Requester", meaning: "Who asked. Told when the status changes, unless they changed it themselves." },
  {
    term: "Assignee",
    meaning: "Who does it. Sees it under To me. The assignee, the requester or an admin can change the status.",
  },
  {
    term: "Thread",
    meaning:
      "Every Telegram reply tied to a request, at any depth: replies to the request, to the bot's confirmation, or to other replies. Shown on the request page with Open in Telegram links. It doesn't change the request text; /append does.",
  },
  {
    term: "Status line",
    meaning: "A status command sent in the thread shows as a small line, like “✅ Ravi marked this done: ‘projector fixed’”. It isn't counted as a reply, but you can still reply to it.",
  },
  { term: "Open", meaning: "Status: not started." },
  { term: "Doing", meaning: "Status: the assignee is on it." },
  { term: "Waiting", meaning: "Status: blocked on someone or something. The custom label says what." },
  { term: "Done", meaning: "Status: finished." },
  { term: "Declined", meaning: "Status: won't be done. Usually the assignee said no; the requester or an admin can also decline it." },
  {
    term: "Custom label",
    meaning: "Free text shown instead of the status name, like “ordering from Panjim”. /waiting <reason> sets one; the status underneath stays.",
  },
  {
    term: "Deliverable",
    meaning:
      "What was delivered: the /done note plus the message it points to, with its photos or files. On the web: the Done sheet asks “What was delivered?”, and any message has ⭐ Mark as deliverable.",
  },
  {
    term: "Delivered card",
    meaning: "The ✅ Delivered card at the top of a done request: the note, images, who delivered it and when, and a link to the Telegram message. Done rows in lists show the note too.",
  },
  {
    term: "On behalf",
    meaning: "When the requester or an admin closes a request for the assignee. It reads “closed by Naman on behalf of @bob”, and @bob is the one told.",
  },
  { term: "Priority", meaning: "low, normal, high or urgent. The AI guesses from the text; change it on the request page." },
  { term: "Due date", meaning: "When it's needed. The AI reads “tomorrow” or “by Friday”; edit it on the page. Overdue shows in red." },
  { term: "AI title", meaning: "A short title written from the messages, like “Fix the dome projector”. Edit it and it stays yours." },
  {
    term: "Context question",
    meaning: "When the AI is unsure, it asks one short question on the request page. An admin's answer teaches it for next time.",
  },
  { term: "To me", meaning: "Your inbox: requests assigned to you, in the buckets New, Act, Upcoming, Waiting, Done." },
  { term: "I asked", meaning: "Your outbox: requests you raised. Never mixed with To me." },
  { term: "New", meaning: "To me bucket: open requests you haven't opened yet." },
  { term: "Act", meaning: "To me bucket: open or doing, due today, tomorrow, overdue, or undated." },
  { term: "Upcoming", meaning: "To me bucket: open or doing, due after tomorrow." },
  { term: "Waiting (bucket)", meaning: "Requests in Waiting; the label says who or what they wait on." },
  { term: "Done (bucket)", meaning: "Done or declined in the last 14 days, collapsed by default." },
  {
    term: "I asked tiles",
    meaning: "Counts at the top of I asked: Overdue (the only red one), Open, Doing, Waiting, Done this week. Tap one to filter the list.",
  },
  {
    term: "I asked sections",
    meaning: "Overdue, Active, Waiting, then Recently done (collapsed). Below them, People: who has your requests, those with overdue or waiting items first.",
  },
  {
    term: "MCP token",
    meaning: "A key starting etm_ from Settings that lets your AI agent (Claude Code, claude.ai) read and update your requests as you. Shown once; revoke any time.",
  },
];

/** The bot's /help, as plain text lines (the bot HTML-escapes them). */
export function helpLines(bot: string): string[] {
  return [
    "Ask anyone for something, or update a request:",
    ...COMMAND_ENTRIES.filter((e) => e.help).map((e) => withBot(`${e.term}: ${e.help}`, bot)),
    "",
    "Status commands work as a reply to any message of a request, or with its id (/done 12). The assignee, the requester or an admin can use them.",
  ];
}

/** The README's "Bot commands" table. */
export function commandsMarkdown(bot: string): string {
  const cell = (s: string) => withBot(s, bot).replaceAll("|", "\\|");
  return [
    "| You type | What happens |",
    "| --- | --- |",
    // <what> outside backticks would vanish as an HTML tag on GitHub
    ...COMMAND_ENTRIES.map((e) => `| \`${cell(e.term)}\` | ${cell(e.meaning).replaceAll("<", "&lt;")} |`),
  ].join("\n");
}
