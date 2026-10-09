import { describe, expect, it } from "vitest";
import { replyQuote } from "./Thread";

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
