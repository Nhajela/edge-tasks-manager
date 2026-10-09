/**
 * The tutorial as data: the landing page renders it, and the bot's /help and the README can reuse it.
 * `@bot` in any string is a placeholder for the real bot username; render through `withBot`.
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

export type Entry = { term: string; meaning: string; example?: string };

export const withBot = (s: string, bot: string) => s.replaceAll("@bot", `@${bot}`);

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
      { from: "bot", name: "Edge Tasks", text: "📝 #12 for @bob: Fix the projector" },
    ],
  },
  {
    title: "Turn someone's message into a request",
    body: "Reply to their message with /request and you take it on. Add @bob to hand it to bob instead.",
    chat: [
      { from: "them", name: "Asha", text: "can someone grab chairs for the talk?" },
      { from: "you", reply: "can someone grab chairs for the talk?", text: "/request" },
      { from: "bot", name: "Edge Tasks", text: "📝 #13 for you: Grab chairs for the talk" },
    ],
  },
  {
    title: "Add more",
    body: "Reply to any message with /append and it joins that person's latest request. Plain replies to the bot's confirmation are added too.",
    chat: [
      { from: "them", name: "Asha", text: "and the HDMI cable is missing" },
      { from: "you", reply: "and the HDMI cable is missing", text: "/append" },
      { from: "bot", name: "Edge Tasks", text: "➕ Added to #12" },
    ],
  },
  {
    title: "Talk it out",
    body: "Replies to the request, and replies to those replies, become its thread on the web. No command needed.",
    chat: [
      { from: "them", name: "Bob", reply: "📝 #12 for @bob: Fix the projector", text: "Which room?" },
      { from: "you", reply: "Which room?", text: "Dome, back wall" },
    ],
  },
  {
    title: "Update from the thread",
    body: "Reply anywhere in the thread with a status command. The requester is told.",
    chat: [
      { from: "you", reply: "Dome, back wall", text: "/doing" },
      { from: "you", reply: "Dome, back wall", text: "/waiting cable on order" },
      { from: "you", reply: "Dome, back wall", text: "/done new bulb fitted" },
      { from: "bot", name: "Edge Tasks", text: "✅ #12 is done: Fix the projector" },
    ],
  },
  {
    title: "See everything",
    body: "Log in with Telegram. To me is what people asked of you; I asked is what you asked of others. In Telegram, /mine and /raised do the same.",
    chat: [
      { from: "you", text: "/mine" },
      { from: "bot", name: "Edge Tasks", text: "For you (1)\n#13 Grab chairs for the talk — Open · due today" },
    ],
  },
  {
    title: "Optional: connect your AI agent",
    body: "In Settings, create an MCP token and paste the config into Claude Code or claude.ai. Your agent can then read and update your requests as you.",
    chat: [],
  },
];

export const COMMAND_ENTRIES: Entry[] = [
  { term: "/request @bob <what>", meaning: "Ask @bob for something. Without an @name it goes to the organiser.", example: "/request @bob fix the projector" },
  {
    term: "@bot @bob <what>",
    meaning: "Same as /request. The bot mention must be the first thing in the message; a “thanks @bot” later in a sentence does nothing.",
    example: "@bot @bob fix the projector",
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
  },
  {
    term: "/append (/add, /more)",
    meaning: "Reply to a message to add it to that person's latest open request. /append 12 picks a request. Plain-text replies to the bot's “#12” message are added too.",
    example: "/append 12",
  },
  { term: "/doing", meaning: "Mark Doing. Reply in the thread, or give the id.", example: "/doing 12" },
  { term: "/waiting <reason>", meaning: "Mark Waiting; the reason becomes the label people see.", example: "/waiting cable on order" },
  { term: "/done <note>", meaning: "Mark Done. The note is saved as a comment and the requester is told.", example: "/done new bulb fitted" },
  { term: "/decline <reason>", meaning: "Say no, with a reason. The requester is told.", example: "/decline not my area, try @asha" },
  { term: "/reopen", meaning: "Back to Open.", example: "/reopen 12" },
  { term: "/mine", meaning: "Open requests for you: Act, then New, then Upcoming. Max 10.", example: "/mine" },
  { term: "/raised", meaning: "Open requests you asked for, overdue first.", example: "/raised" },
  { term: "/with @bob", meaning: "Everything open between you and @bob, both ways.", example: "/with @bob" },
  { term: "/status 12", meaning: "One request: title, status, due, who asked whom.", example: "/status 12" },
  { term: "/help", meaning: "This list, inside Telegram.", example: "/help" },
  { term: "/start", meaning: "Message the bot once so it can message you back. Also finishes a web login.", example: "/start" },
];

export const WORD_ENTRIES: Entry[] = [
  { term: "Request", meaning: "One ask, numbered like #12. It has a title, a requester, an assignee, a status and a thread." },
  { term: "Requester", meaning: "Who asked. Told when the status changes." },
  { term: "Assignee", meaning: "Who does it. Sees it under To me. Only the assignee, the requester or an admin can change the status." },
  {
    term: "Thread",
    meaning: "Every Telegram reply tied to a request, at any depth, shown on the request page with Open in Telegram links. The thread doesn't change the request text; /append does.",
  },
  { term: "Open", meaning: "Status: not started." },
  { term: "Doing", meaning: "Status: the assignee is on it." },
  { term: "Waiting", meaning: "Status: blocked on someone or something. The custom label says what." },
  { term: "Done", meaning: "Status: finished." },
  { term: "Declined", meaning: "Status: the assignee said no." },
  {
    term: "Custom label",
    meaning: "Free text shown instead of the status name, like “ordering from Panjim”. /waiting <reason> sets one; the status underneath stays.",
  },
  { term: "Priority", meaning: "low, normal, high or urgent. The AI guesses from the text; change it on the request page." },
  { term: "Due date", meaning: "When it's needed. The AI reads “tomorrow” or “by Friday”; edit it on the page. Overdue shows in red." },
  { term: "AI title", meaning: "A short title written from the messages, like “Fix the dome projector”. Edit it and it stays yours." },
  {
    term: "Context question",
    meaning: "When the AI is unsure, it asks one short question on the request page. An admin's answer teaches it for next time.",
  },
  { term: "To me", meaning: "Your inbox: requests assigned to you." },
  { term: "I asked", meaning: "Your outbox: requests you raised. Never mixed with To me." },
  { term: "New", meaning: "To me bucket: open requests you haven't looked at yet." },
  { term: "Act", meaning: "To me bucket: open or doing, due today, tomorrow, overdue, or undated." },
  { term: "Upcoming", meaning: "To me bucket: open or doing, due after tomorrow." },
  { term: "Waiting (bucket)", meaning: "Requests in Waiting; the label says who or what they wait on." },
  { term: "Done (bucket)", meaning: "Done or declined in the last 14 days, collapsed by default." },
  {
    term: "MCP token",
    meaning: "A key starting etm_ from Settings that lets your AI agent (Claude Code, claude.ai) read and update your requests as you. Shown once; revoke any time.",
  },
];
