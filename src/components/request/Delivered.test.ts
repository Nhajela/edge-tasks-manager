import { describe, expect, it } from "vitest";
import { deliveredInfo } from "./Delivered";

const e = (action: string, actorLabel: string, data: Record<string, unknown> | null) => ({ action, actorLabel, data }) as never;

describe("deliveredInfo", () => {
  it("credits whoever recorded the result last and says who closed it on whose behalf", () => {
    const tl = [
      e("request.status", "@lucy", { to: "done", result: { note: "fixed", messageId: null } }),
      e("request.status", "@lucy", { to: "open" }),
      e("request.status", "@naman", { to: "done", onBehalfOf: 6, result: { note: "fixed again", messageId: null } }),
      e("request.comment", "@lucy", { notify: false }),
    ];
    expect(deliveredInfo(tl)).toEqual({ by: "@naman", closedBy: "@naman" });
  });

  it("a later ⭐ moves the credit; the assignee closing it is not 'on behalf'", () => {
    const tl = [e("request.status", "@lucy", { to: "done", note: null }), e("request.deliverable", "@asha", { messageId: 9, from: null })];
    expect(deliveredInfo(tl)).toEqual({ by: "@asha", closedBy: null });
  });

  it("falls back when nothing recorded a result", () => {
    expect(deliveredInfo([])).toEqual({ by: "someone", closedBy: null });
  });
});
