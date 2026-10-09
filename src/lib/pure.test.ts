import { describe, expect, it } from "vitest";
import { fileUrl, signFileId, verifyFileSig } from "./files";
import { messageLink } from "./messageLink";
import { heuristicTitle } from "./title";

describe("messageLink", () => {
  it("supergroups use t.me/c with the -100 stripped", () => {
    expect(messageLink({ id: -1001234567890, type: "supergroup" }, 42)).toBe("https://t.me/c/1234567890/42");
  });
  it("public groups with a username use it", () => {
    expect(messageLink({ id: -1001234567890, type: "supergroup", username: "edgecity" }, 42)).toBe("https://t.me/edgecity/42");
  });
  it("DMs and basic groups have no link", () => {
    expect(messageLink({ id: 9100000001, type: "private" }, 1)).toBeNull();
    expect(messageLink({ id: -4512345, type: "group" }, 1)).toBeNull();
  });
});

describe("heuristicTitle", () => {
  it("takes the first ~8 words, capitalised, without mentions or commands", () => {
    expect(heuristicTitle("/request @bob please fix the projector in the main hall before tonight's talk")).toBe(
      "Please fix the projector in the main hall…",
    );
  });
  it("uses the first line and trims punctuation", () => {
    expect(heuristicTitle("need water bottles.\nmore detail here")).toBe("Need water bottles");
  });
  it("falls back for empty text", () => {
    expect(heuristicTitle("  @bob ")).toBe("Request");
  });
  it("stays within 60 characters", () => {
    expect(heuristicTitle("a".repeat(200)).length).toBeLessThanOrEqual(60);
  });
});

describe("file URL signing", () => {
  it("round-trips and rejects tampering", () => {
    process.env.FILES_SECRET = "test-files-secret";
    const sig = signFileId(12);
    expect(verifyFileSig(12, sig)).toBe(true);
    expect(verifyFileSig(13, sig)).toBe(false);
    expect(verifyFileSig(12, sig.slice(0, -1) + "x")).toBe(false);
    expect(verifyFileSig(12, null)).toBe(false);
    expect(fileUrl(12)).toMatch(/\/api\/files\/12\?sig=[A-Za-z0-9_-]+$/);
  });
});
