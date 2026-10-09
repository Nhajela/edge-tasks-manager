import { describe, expect, it } from "vitest";
import { safeNext } from "./links";

describe("safeNext", () => {
  it.each([
    ["/inbox", "/inbox"],
    ["/r/12?x=1#t", "/r/12?x=1#t"],
    ["//evil.com", "/"],
    ["/\\evil.com", "/"],
    ["https://evil.com", "/"],
    ["/\t/evil.com", "/"],
    ["/\n/evil.com", "/"],
    ["/\r/evil.com", "/"],
    [null, "/"],
  ])("%j -> %j", (input, out) => expect(safeNext(input)).toBe(out));
});
