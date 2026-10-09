// Points the Telegram bot at the deployed webhook and sets its name, commands and descriptions. Safe to re-run.
// Usage: pnpm bot:setup https://<site>   (or set NEXT_PUBLIC_SITE_URL). Needs TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET.
const site = process.argv[2] ?? process.env.NEXT_PUBLIC_SITE_URL;
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!token || !secret) throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET must be set");
if (!site?.startsWith("https://")) throw new Error("Pass the https:// site URL (Telegram only calls https webhooks)");

let failed = false;
async function call(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) failed = true;
  console.log(method, json.ok ? "ok" : json);
  return json;
}

await call("setWebhook", {
  url: new URL("/api/telegram", site).toString(),
  secret_token: secret,
  allowed_updates: ["message", "edited_message", "callback_query", "my_chat_member"],
});
await call("setMyName", { name: "Edge Tasks" });
await call("setMyCommands", {
  commands: [
    { command: "request", description: "Ask someone to do something: /request @bob fix the projector" },
    { command: "append", description: "Reply to a message to add it to a request (or /append 12)" },
    { command: "mine", description: "Open requests assigned to you" },
    { command: "raised", description: "Open requests you raised" },
    { command: "with", description: "Open requests between you and someone: /with @bob" },
    { command: "status", description: "Status of one request: /status 12" },
    { command: "done", description: "Mark a request done: /done 12" },
    { command: "help", description: "How to use Edge Tasks" },
  ],
});
await call("setMyDescription", {
  description:
    "Edge Tasks turns Telegram messages into a shared task list for Edge City India. In any group: /request @someone <what>, or reply to a message with /request. Replies to a request's messages are kept as its thread. Tap Start to log in to your dashboard.\n\nA community project by Edge City attendees, not an official Edge City app.",
});
await call("setMyShortDescription", {
  short_description: "Raise and track requests for Edge City India right from Telegram. Community project, not official.",
});
const me = await call("getMe", {});
await call("getWebhookInfo", {});

console.log(
  me.result?.can_read_all_group_messages
    ? "\nPrivacy mode is off: reply threads work in every group."
    : "\nACTION NEEDED: in @BotFather send /setprivacy, pick this bot, choose Disable. Then remove and re-add the bot " +
        "to existing groups (privacy applies when it joins). Without this, replies to people's messages are not threaded.",
);
if (failed) process.exitCode = 1;
