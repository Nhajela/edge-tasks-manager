import { describe, expect, it } from "vitest";
import { activeHref, navItems } from "./navItems";

describe("navItems", () => {
  it("shows To me, I asked, Settings to everyone", () => {
    expect(navItems(false).map((i) => i.label)).toEqual(["To me", "I asked", "Settings"]);
  });
  it("adds All, Activity, Context for admins, Settings last", () => {
    expect(navItems(true).map((i) => i.label)).toEqual(["To me", "I asked", "All", "Activity", "Context", "Settings"]);
  });
});

describe("activeHref", () => {
  const admin = navItems(true);
  it.each([
    ["/inbox", "/inbox"],
    ["/inbox?status=done", "/inbox"],
    ["/raised", "/raised"],
    ["/admin", "/admin"],
    ["/admin/activity", "/admin/activity"],
    ["/context", "/context"],
    ["/settings", "/settings"],
    ["/r/12", null],
    ["/with/bob", null],
    ["/inboxes", null],
  ])("%s -> %s", (path, want) => {
    expect(activeHref(admin, path)).toBe(want);
  });
});
