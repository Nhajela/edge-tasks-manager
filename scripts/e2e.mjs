// End-to-end QA: a fresh LOCAL database (etm_e2e on :5545, never Neon), a dev server on :3400, the bot driven with
// sim-webhook scenarios, then the web app in real Chrome (Playwright) and MCP over HTTP. Exits non-zero on failure.
// Usage: pnpm e2e        (SHOTS=1 also saves docs/screenshots/final/*.png at 390 and 1280)
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { chromium } from "playwright-core";

const PORT = 3400;
const BASE = `http://localhost:${PORT}`;
const DB_URL = "postgres://postgres@localhost:5545/etm_e2e";
const ADMIN = { id: 9100000099, first_name: "Admin", username: "e2eadmin" };
const SHOTS = process.env.SHOTS === "1";
const SHOT_DIR = "docs/screenshots/final";
const OUTBOX = join(tmpdir(), "edge-tasks-outbox.jsonl");

// Shell env beats .env.local in next dev, and "" counts as set: no real bot, no real AI, no Neon.
const ENV = {
  ...process.env,
  DATABASE_URL: DB_URL,
  SUPERADMIN_TELEGRAM_ID: String(ADMIN.id),
  SUPERADMIN_USERNAME: ADMIN.username,
  TELEGRAM_BOT_TOKEN: "",
  TELEGRAM_SEND_IN_DEV: "",
  TELEGRAM_BOT_USERNAME: "EdgeTasksBot",
  NEXT_PUBLIC_TELEGRAM_BOT_USERNAME: "EdgeTasksBot",
  TELEGRAM_WEBHOOK_SECRET: "e2e-webhook-secret",
  SESSION_SECRET: "e2e-session-secret-not-a-real-secret-0123456789",
  NEXT_PUBLIC_SITE_URL: BASE,
  OPENROUTER_API_KEY: "",
  NODE_ENV: "development",
};

const t0 = Date.now();
const timings = [];
async function step(name, fn) {
  const s = Date.now();
  try {
    const r = await fn();
    timings.push([name, Date.now() - s]);
    console.log(`ok   ${name} (${Date.now() - s}ms)`);
    return r;
  } catch (e) {
    const why = e.cause ? `${e.message} (${e.cause.code ?? e.cause.message ?? e.cause})` : e.message; // fetch hides the reason in cause
    console.log(`FAIL ${name} (${Date.now() - s}ms)\n     ${why.split("\n").join("\n     ")}`);
    throw e;
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
// Grouping checks read main's innerText, so they don't depend on markup: a header line is the bucket/tile title,
// optionally with its count ("Act 3", "Act · 3", or "3 Overdue" for a tile).
const headerRe = (t) => new RegExp(`^(\\d+\\s+)?${t}(\\s*·?\\s*\\d+)?$`, "i");
const hasHeader = (text, t) => text.split("\n").some((l) => headerRe(t).test(l.trim()));
/** Char offsets of the `titles` header lines, which must appear in this order; `end` = the line after the last. */
function linesInOrder(text, titles) {
  const lines = text.split("\n");
  const at = {};
  let i = 0;
  for (const t of titles) {
    while (i < lines.length && !headerRe(t).test(lines[i].trim())) i++;
    if (i === lines.length) throw new Error(`no "${t}" header after the ones before it (${titles.join(", ")})`);
    at[t] = lines.slice(0, i).join("\n").length; // comparable with indexOf
    i++;
  }
  at.end = i;
  return at;
}
/** A grouping header: a button whose name starts with the bucket title. */
const groupHeader = (page, title) => page.getByRole("button", { name: new RegExp(`^\\W*${title}\\b`, "i") }).first();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const node = (args, env = ENV) => execFileSync(process.execPath, args, { env, encoding: "utf8" });

const db = new pg.Client({ connectionString: DB_URL });
const q = async (sql, params) => (await db.query(sql, params)).rows;
async function until(what, fn, ms = 10_000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) if (await fn()) return;
  throw new Error(`timed out waiting for ${what}`);
}

let server;
let stopping = false;
let browser;
try {
  await step("fresh local db etm_e2e", () => node(["scripts/dev-db.mjs", "etm_e2e"]));
  await db.connect();

  await step("dev server :3400 ready", async () => {
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port", String(PORT)], { env: ENV, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    server.stdout.on("data", (d) => (log += d));
    server.stderr.on("data", (d) => (log += d));
    server.on("exit", (c) => c && !stopping && console.log(`dev server exited ${c}\n${log.slice(-2000)}`));
    await until("GET / to answer", () => fetch(BASE).then((r) => r.status < 500, () => false), 120_000);
  });

  const outboxStart = await stat(OUTBOX).then((s) => s.size, () => 0);
  const outbox = async () => (await readFile(OUTBOX).catch(() => Buffer.alloc(0))).subarray(outboxStart).toString("utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

  const SCENARIOS = ["request-at", "reply-request", "mention", "mention-pending", "append", "photo", "thread-chain"];
  // round 2: status from anywhere in the thread, deliverables, closing on someone's behalf
  SCENARIOS.push("done-in-thread", "done-with-photo", "close-on-behalf", "bare-done-assignee");
  for (const name of SCENARIOS)
    await step(`bot: ${name}`, () => {
      const out = node(["scripts/sim-webhook.mjs", BASE, name]);
      const bad = out.split("\n").filter((l) => /^ {3}\d{3} /.test(l) && !l.startsWith("   200 "));
      assert(!bad.length, `non-200 webhook answers:\n${bad.join("\n")}`);
    });

  // the superadmin says something to the bot once so they have a people row to log in with
  await step("bot: admin DM /help", async () => {
    const message = { message_id: 1, date: Math.floor(Date.now() / 1000), chat: { id: ADMIN.id, type: "private" }, from: ADMIN, text: "/help", entities: [{ type: "bot_command", offset: 0, length: 5 }] };
    const post = () => fetch(`${BASE}/api/telegram`, { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": ENV.TELEGRAM_WEBHOOK_SECRET }, body: JSON.stringify({ update_id: 1, message }) });
    // the keep-alive socket from the readiness poll may have been closed by the server while the scenarios ran
    const r = await post().catch((e) => (e.cause?.code === "ECONNRESET" ? post() : Promise.reject(e)));
    assert(r.status === 200, `webhook ${r.status}`);
  });

  const created = await step("db: scenarios created requests", async () => {
    const rows = await q("SELECT r.id, r.body, a.username AS assignee FROM requests r JOIN people a ON a.id = r.assignee_id ORDER BY r.id");
    const want = ["projector in the dome", "wifi in villa 3", "drinking water", "extension cords", "beach shack", "generator fuel", "40 chairs", "fridge", "library", "leak under the sink", "leaking tap"];
    const missing = want.filter((w) => !rows.some((r) => r.body.toLowerCase().includes(w)));
    assert(!missing.length, `no request for: ${missing.join(", ")} (have ${rows.length})`);
    const fridge = rows.find((r) => r.body.includes("fridge"));
    assert(/freezer/.test(fridge.body) && /milk/.test(fridge.body), `appends missing from fridge body: ${fridge.body}`);
    const pics = await q("SELECT count(*)::int AS n FROM attachments");
    assert(pics[0].n >= 2, `expected photo attachments, got ${pics[0].n}`);
    return rows;
  });
  const tap = created.find((r) => r.body.includes("leaking tap"));
  // round 2 rule: a plain reply to the bot's confirmation is a thread message (only an explicit /append changes the
  // body), so the chain is 4 thread replies, in order, each with its reply_to.
  const thread = await step("db: thread-chain = 4 thread replies (reply-to-confirmation lands in the thread)", async () => {
    assert(tap.assignee === "ben", `tap assignee ${tap.assignee}`);
    const rows = await q("SELECT kind, text, reply_to_message_id IS NOT NULL AS quoted FROM request_messages WHERE request_id = $1 AND kind <> 'original' ORDER BY id", [tap.id]);
    const kinds = rows.map((r) => r.kind).join(",");
    assert(kinds === "thread,thread,thread,thread" && rows.every((r) => r.quoted), `chain on #${tap.id}: ${kinds}`);
    return rows;
  });

  const byBody = async (text) => {
    const [r] = await q("SELECT * FROM requests WHERE body ILIKE $1 ORDER BY id DESC LIMIT 1", [`%${text}%`]);
    assert(r, `no request for: ${text}`);
    return r;
  };
  const kindsOf = async (id) => (await q("SELECT kind FROM request_messages WHERE request_id = $1 ORDER BY id", [id])).map((r) => r.kind).join(",");
  const audits = (id, action) => q("SELECT data FROM audit_log WHERE entity_type = 'request' AND entity_id = $1 AND action = $2 ORDER BY id", [String(id), action]);

  const table = await step("db: done-in-thread closes from the deepest reply (status message, result note)", async () => {
    const r = await byBody("wobbly table");
    assert(r.status === "done", `#${r.id} status ${r.status}`);
    assert(r.result_note === "shimmed both legs, rock solid now", `result_note ${r.result_note}`);
    const kinds = await kindsOf(r.id);
    assert(kinds === "original,thread,thread,thread,status", `messages on #${r.id}: ${kinds}`);
    const st = await audits(r.id, "request.status");
    assert(st.length === 1 && !st[0].data.onBehalfOf, `status audit rows: ${JSON.stringify(st)}`);
    return r;
  });
  await step("db: done-with-photo makes the photo message the deliverable", async () => {
    const r = await byBody("sign for the quiet room");
    assert(r.status === "done" && r.result_note === "sign is up by the door", `#${r.id} ${r.status} ${r.result_note}`);
    const [m] = await q("SELECT kind, chat_id, message_id FROM request_messages WHERE id = $1", [r.result_message_id]);
    assert(m?.kind === "status", `result message ${JSON.stringify(m)}`);
    const [{ n }] = await q("SELECT count(*)::int AS n FROM attachments WHERE request_id = $1 AND message_id = $2", [r.id, m.message_id]);
    assert(n === 1, `deliverable photos ${n}`);
  });
  const behalf = await step("db: close-on-behalf records the requester closing for @ben, deliverable = Ben's photo", async () => {
    const r = await byBody("week-2 schedule");
    const [ben, asha] = await Promise.all(["ben", "asha"].map(async (u) => (await q("SELECT id FROM people WHERE username = $1", [u]))[0].id));
    assert(r.status === "done" && r.result_by_id === asha, `#${r.id} ${r.status} result_by ${r.result_by_id}`);
    assert(r.result_note === "all 30 picked up, thanks Ben", `result_note ${r.result_note}`);
    const [m] = await q("SELECT kind, from_id FROM request_messages WHERE id = $1", [r.result_message_id]);
    assert(m?.kind === "thread" && m.from_id === ben, `result message ${JSON.stringify(m)}`);
    const st = await audits(r.id, "request.status");
    assert(st.length === 1 && st[0].data.onBehalfOf === ben, `status audit: ${JSON.stringify(st)}`);
    return r;
  });
  await step("outbox: assignee @ben told about the on-behalf close (not the requester)", async () => {
    const ben = (await q("SELECT telegram_id FROM people WHERE username = 'ben'"))[0].telegram_id;
    const mine = (e) => (e.text ?? e.caption ?? "").includes(`#${behalf.id}`) && /done/i.test(e.text ?? e.caption ?? "");
    await until("on-behalf notification", async () =>
      (await outbox()).some((e) => mine(e) && (String(e.chatId) === String(ben) || /^@ben\b/.test(e.text ?? e.caption ?? ""))), 5000);
    const toAsha = (await outbox()).filter((e) => mine(e) && /^@asha\b/.test(e.text ?? e.caption ?? ""));
    assert(!toAsha.length, `the requester (the actor) was notified: ${JSON.stringify(toAsha)}`);
  });
  await step("bare-done-assignee: stays open, lands in the thread, bot offers 'Mark done?'", async () => {
    const r = await byBody("water dispenser");
    assert(r.status === "open", `#${r.id} status ${r.status}`);
    const kinds = await kindsOf(r.id);
    assert(kinds === "original,thread", `messages on #${r.id}: ${kinds}`);
    await until("Mark done? prompt", async () =>
      (await outbox()).some((e) => (e.text ?? "").includes(`#${r.id}`) && /done\?/i.test(e.text ?? "") && JSON.stringify(e.buttons ?? e.reply_markup ?? "").includes(`${r.id}`)), 5000);
  });

  // every inbox/raised bucket for ben and asha (the seeded people share the sim's fake telegram ids)
  await step("seed: round 2 bucket data", () => node(["scripts/seed-dev.mjs"]));
  const delivered = await byBody("best photos from opening night");

  browser = await chromium.launch({ channel: "chrome" });
  const loginAs = async (who, width = 390) => {
    const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 } });
    const page = await ctx.newPage();
    const url = node(["scripts/dev-login.mjs", who, BASE]).trim();
    await page.goto(url);
    await page.getByRole("button", { name: /^Continue as/ }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
    return { ctx, page };
  };

  // Groups show 5 rows, then "Show N more": open them all so a row can be found.
  const showAll = async (page) => {
    const more = page.getByRole("button", { name: /^Show \d+ more$/ }).first();
    while (await more.isVisible()) await more.click();
  };

  const ben = await step("web: log in as the assignee (@ben)", () => loginAs("ben"));
  await step("web: inbox lists the request", async () => {
    await ben.page.goto(`${BASE}/inbox`);
    await showAll(ben.page);
    await ben.page.locator(`a[href="/r/${tap.id}"]`).first().waitFor();
  });
  await step("web: detail shows the thread chain with reply quotes", async () => {
    await ben.page.locator(`a[href="/r/${tap.id}"]`).first().click();
    await ben.page.waitForURL(`**/r/${tap.id}`);
    await ben.page.getByText("Thread · 4").waitFor();
    const text = await ben.page.locator("main").innerText();
    for (const t of thread) assert(text.includes(t.text), `message missing: ${t.text}`);
    // the first reply quotes the bot confirmation (may or may not render a quote); the last 3 quote people
    const quotes = await ben.page.getByText(/^replying to /).allInnerTexts();
    assert(quotes.length >= 3 && quotes.at(-3).startsWith("replying to @asha: it's the one on the left") && quotes.at(-1).startsWith("replying to @ben"), `reply quotes: ${quotes.join(" | ")}`);
  });
  const statusIs = (s) => until(`status ${s}`, async () => (await q("SELECT status FROM requests WHERE id = $1", [tap.id]))[0].status === s);
  await step("web: set Doing", async () => {
    await ben.page.getByRole("radio", { name: "Doing" }).click();
    await statusIs("in_progress");
  });
  await step("web: comment", async () => {
    await ben.page.locator("#comment").fill("Swapped the washer, testing it now");
    await ben.page.getByRole("button", { name: "Comment" }).click();
    await ben.page.getByText(/will get it on Telegram|Comment added/).waitFor();
  });
  await step("web: mark done", async () => {
    await ben.page.getByRole("radio", { name: "Done" }).click();
    // round 2: Done may open a "What was delivered? (optional)" sheet first
    const sheet = ben.page.getByRole("dialog");
    if (await sheet.waitFor({ timeout: 2000 }).then(() => true, () => false)) {
      await sheet.getByRole("textbox").first().fill("New washer, no more drips");
      await sheet.getByRole("button", { name: /done|save|confirm/i }).last().click();
    }
    await statusIs("done");
  });
  await step("audit: one row per step", async () => {
    const rows = await q("SELECT action FROM audit_log WHERE entity_type = 'request' AND entity_id = $1 ORDER BY id", [String(tap.id)]);
    const actions = rows.map((r) => r.action);
    for (const a of ["request.create", "request.thread", "request.status", "request.comment"]) assert(actions.includes(a), `no ${a} in ${actions.join(", ")}`);
    assert(actions.filter((a) => a === "request.thread").length === 4, `thread audit rows: ${actions.join(", ")}`);
    assert(actions.filter((a) => a === "request.status").length === 2, `status audit rows: ${actions.join(", ")}`);
  });
  await step("outbox: requester told it's done", async () => {
    await until("done notification", async () => (await outbox()).some((e) => e.text?.includes(`#${tap.id}`) && /done/i.test(e.text) && /asha/i.test(e.text)), 5000);
  });

  const asha = await step("web: requester (@asha) /raised shows it under Recently done", async () => {
    const s = await loginAs("asha");
    await s.page.goto(`${BASE}/raised`);
    const link = s.page.locator(`a[href="/r/${tap.id}"]`).first();
    if (!(await link.isVisible())) await groupHeader(s.page, "Recently done").click(); // collapsed by default
    await showAll(s.page);
    await link.waitFor();
    return s;
  });

  await step("web: /inbox (@ben) groups into New, Act, Upcoming, Waiting, Done in that order", async () => {
    await ben.page.goto(`${BASE}/inbox`);
    await groupHeader(ben.page, "Act").waitFor();
    const text = await ben.page.locator("main").innerText();
    const at = linesInOrder(text, ["New", "Act", "Upcoming", "Waiting", "Done"]);
    const where = (t) => text.toLowerCase().indexOf(t);
    assert(where("projector screen") > at.Act && where("projector screen") < at.Upcoming, "overdue item not in Act");
    assert(where("collect the drone") > at.Act && where("collect the drone") < at.Upcoming, "due-tomorrow item not in Act");
    assert(where("stage for closing night") > at.Upcoming && where("stage for closing night") < at.Waiting, "later item not in Upcoming");
    assert(where("waiting on the supplier quote") > at.Waiting, "custom waiting label not shown in Waiting");
    assert(where("generator before the beach party") > at.New && where("generator before the beach party") < at.Act, "unseen item not in New");
  });

  await step("web: /raised (@asha) tiles Overdue, Open, Doing, Waiting, Done this week, then sections", async () => {
    await asha.page.goto(`${BASE}/raised`);
    await asha.page.getByText("Done this week").first().waitFor();
    const text = await asha.page.locator("main").innerText();
    const tiles = linesInOrder(text, ["Overdue", "Open", "Doing", "Waiting", "Done this week"]);
    const after = text.split("\n").slice(tiles.end).join("\n");
    linesInOrder(after, ["Overdue", "Active", "Waiting", "Recently done"]);
    assert(after.toLowerCase().includes("vegan options"), "overdue seeded request missing");
    // tapping a tile filters the list: Overdue keeps the overdue item and drops the Active section
    const main = asha.page.locator("main");
    await main.getByRole("button", { name: /overdue/i }).or(main.getByRole("link", { name: /overdue/i })).first().click();
    await until("Overdue tile filter", async () => {
      const t = await main.innerText();
      return t.toLowerCase().includes("vegan options") && !hasHeader(t, "Active");
    }, 5000);
  });

  await step("web: on-behalf close shows the Delivered card at the very top + system line", async () => {
    await asha.page.goto(`${BASE}/r/${behalf.id}`);
    await asha.page.getByText(/Delivered/).first().waitFor();
    const text = await asha.page.locator("main").innerText();
    const card = text.indexOf("Delivered");
    assert(card >= 0 && card < text.indexOf("print 30 copies"), "Delivered card is not above the original message");
    assert(text.indexOf("all 30 picked up, thanks Ben") > card, "result note missing from the card");
    assert(/on behalf of @ben/i.test(text), "no 'on behalf of @ben' system line");
    assert((await asha.page.locator("main img").count()) >= 1, "deliverable image missing");
  });

  await step("web: seeded delivered request shows its card first", async () => {
    await asha.page.goto(`${BASE}/r/${delivered.id}`);
    await asha.page.getByText(/Delivered/).first().waitFor();
    const text = await asha.page.locator("main").innerText();
    assert(text.indexOf("Delivered") < text.lastIndexOf("Send me the best photos"), "Delivered card is not above the original message"); // the title above the card repeats the text
    assert(text.includes("3 photos picked for the newsletter"), "seeded result note missing");
  });

  await step("web: in-thread /done renders as a status system line, not a thread bubble", async () => {
    await ben.page.goto(`${BASE}/r/${table.id}`);
    await ben.page.getByText(/marked this done/i).first().waitFor();
    const text = await ben.page.locator("main").innerText();
    assert(/@?ben marked this done/i.test(text) && text.includes("shimmed both legs"), "system line lacks who/note");
    await ben.page.getByText("Thread · 3").waitFor(); // the status message is not counted
  });

  await step("web: /admin/activity shows each step", async () => {
    const s = await loginAs(String(ADMIN.id));
    await s.page.goto(`${BASE}/admin/activity`);
    const text = await s.page.locator("main").innerText();
    assert(text.includes("Swapped the washer"), "comment missing from activity");
    for (const a of ["request.create", "request.thread", "request.status", "request.comment"]) assert(text.includes(a), `${a} missing from activity`);
  });

  const token = await step("web: create an MCP token on /settings", async () => {
    await ben.page.goto(`${BASE}/settings`);
    await ben.page.locator("#mcp-token-name").fill("e2e");
    await ben.page.getByRole("button", { name: "Create token" }).click();
    const code = ben.page.locator("code", { hasText: /^etm_[A-Za-z0-9_-]{16,}$/ }).first();
    await code.waitFor();
    return (await code.innerText()).trim();
  });

  await step("mcp: list_requests + get_request with the token", async () => {
    const rpc = async (method, params) => {
      const r = await fetch(`${BASE}/api/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}`, "mcp-protocol-version": "2025-11-25" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const body = await r.text();
      assert(r.status === 200, `${method}: HTTP ${r.status} ${body}`);
      const j = JSON.parse(body);
      assert(!j.error && !j.result?.isError, `${method}: ${JSON.stringify(j).slice(0, 300)}`);
      return j.result;
    };
    await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
    const list = await rpc("tools/call", { name: "list_requests", arguments: { box: "inbox", status: "all" } });
    assert(JSON.stringify(list.structuredContent).includes(`"id":${tap.id}`), "list_requests lacks the request");
    const got = await rpc("tools/call", { name: "get_request", arguments: { id: tap.id } });
    const d = JSON.stringify(got.structuredContent);
    assert(d.includes('"status":"done"') && d.includes("toolbox under the stairs"), "get_request lacks status/thread");
  });

  if (SHOTS)
    await step("screenshots 390 + 1280", async () => {
      mkdirSync(SHOT_DIR, { recursive: true });
      const shots = [
        ["landing", null, "/"],
        ["inbox", "ben", "/inbox"],
        ["raised", "asha", "/raised"],
        ["detail-delivered", "asha", `/r/${behalf.id}`],
        ["detail-thread", "ben", `/r/${tap.id}`],
        ["with", "asha", "/with/ben"],
        ["admin", String(ADMIN.id), "/admin"],
        ["settings", "ben", "/settings"],
        ["context", String(ADMIN.id), "/context"],
      ];
      for (const width of [390, 1280]) {
        const sessions = {};
        for (const [name, who, path] of shots) {
          if (!sessions[who]) sessions[who] = who ? await loginAs(who, width) : { ctx: await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 } }) };
          const page = await sessions[who].ctx.newPage();
          await page.goto(BASE + path, { waitUntil: "networkidle" });
          await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }); // dev-only Next badge
          await page.screenshot({ path: `${SHOT_DIR}/${name}-${width}.png`, fullPage: true });
          await page.close();
        }
        for (const s of Object.values(sessions)) await s.ctx.close();
      }
    });
  console.log(`\nE2E PASSED in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} catch {
  console.log(`\nE2E FAILED after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  await db.end().catch(() => {});
  if (server?.pid) {
    stopping = true;
    // next dev spawns children; kill the whole tree
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    else server.kill("SIGTERM");
  }
}
