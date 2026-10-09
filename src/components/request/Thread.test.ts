import { describe, expect, it } from "vitest";
import { replyQuote, statusLine } from "./Thread";

const person = (id: number, username: string) => ({ id, username, firstName: username }) as never;
const msg = (messageId: number, replyToMessageId: number | null, from: ReturnType<typeof person> | null, text: string) =>
  ({ chatId: -1, messageId, replyToMessageId, from, text }) as never;

describe("replyQuote", () => {
  const asha = person(1, "asha");
  const ben = person(2, "ben");
  // SPEC chain: bot confirms (100) <- Asha (101) <- Ben (102) <- Asha (103); Chitra (104) answers Ben
  const all = [msg(101, 100, asha, "Plumber said 4pm"), msg(102, 101, ben, "I can let him in, I'm there all afternoon"), msg(104, 102, null, "Spare key")];

  it("names the author and snippets the message replied to", () => {
    expect(replyQuote(all[1], all, 100)).toEqual({ name: "@asha", snippet: "Plumber said 4pm" });
    expect(replyQuote(all[2], all, 100)).toEqual({ name: "@ben", snippet: "I can let him in, I'm there all afternoon" });
  });

  it("quotes the bot confirmation", () => {
    expect(replyQuote(all[0], all, 100)).toEqual({ name: "the bot", snippet: "request confirmation" });
  });

  it("clips long snippets and skips non-replies or unknown targets", () => {
    const long = msg(200, null, asha, "x".repeat(200));
    expect(replyQuote(msg(201, 200, ben, "ok"), [long], null)?.snippet).toHaveLength(81);
    expect(replyQuote(msg(202, null, ben, "hi"), all, 100)).toBeNull();
    expect(replyQuote(msg(203, 999, ben, "hi"), all, 100)).toBeNull();
  });
});

describe("statusLine", () => {
  const ravi = person(5, "ravi");
  const lucy = person(6, "lucy");
  const naman = person(7, "naman");
  const cmd = (messageId: number, from: unknown, text: string) => ({ messageId, from, text }) as never;
  const row = (data: Record<string, unknown>) => ({ action: "request.status", data }) as never;

  it("reads the status audit row recorded for that command", () => {
    const tl = [row({ to: "done", note: "projector fixed", messageId: 301 })];
    expect(statusLine(cmd(301, ravi, "/done projector fixed"), tl, ravi)).toBe("✅ @ravi marked this done: “projector fixed”");
  });

  it("says on whose behalf someone else closed it", () => {
    const tl = [row({ to: "done", note: null, messageId: 302, onBehalfOf: 6 })];
    expect(statusLine(cmd(302, naman, "/done"), tl, lucy)).toBe("✅ @naman marked this done on behalf of @lucy");
  });

  it("words the other statuses and the custom label", () => {
    expect(statusLine(cmd(303, ravi, "/waiting vendor"), [row({ to: "waiting", customStatus: "vendor", messageId: 303 })], ravi)).toBe(
      "⏳ @ravi set it to Waiting (“vendor”)",
    );
    expect(statusLine(cmd(304, ravi, "/reopen"), [row({ to: "open", messageId: 304 })], ravi)).toBe("↩️ @ravi reopened this");
    expect(statusLine(cmd(305, ravi, "/decline no budget"), [row({ to: "declined", note: "no budget", messageId: 305 })], ravi)).toBe(
      "🚫 @ravi declined this: “no budget”",
    );
  });

  it("falls back to the command text when no audit row matches", () => {
    expect(statusLine(cmd(306, ravi, "/done 12"), [], ravi)).toBe("@ravi: /done 12");
  });
});
