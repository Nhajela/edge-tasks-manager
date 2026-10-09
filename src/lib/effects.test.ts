import { describe, expect, it, vi } from "vitest";
import { capturingNotifier } from "@tests/helpers/notifier";
import { runEffects } from "./effects";

describe("runEffects", () => {
  it("sends notifications and titles requests; one failure does not stop the rest", async () => {
    const { notifier, sent } = capturingNotifier();
    const titleRequest = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await runEffects(
      [
        { kind: "title", requestId: 1 },
        { kind: "notify", message: { chatId: 5, html: "hi", kind: "assigned", requestId: 1 } },
        { kind: "title", requestId: 2 },
      ],
      { notifier, titleRequest },
    );
    expect(sent.map((m) => m.chatId)).toEqual([5]);
    expect(titleRequest).toHaveBeenCalledTimes(2);
    expect(err).toHaveBeenCalledOnce();
    err.mockRestore();
  });
});
