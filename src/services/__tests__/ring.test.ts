import { describe, expect, it } from "vitest";
import { testDb } from "@tests/helpers/db";
import { actorFor, makePerson } from "@tests/factories";
import { ValidationError } from "../errors";
import * as ring from "../ring";

const db = testDb();
const msg = { title: "#1 from Bob: generator smoking", url: "https://x/r/1" };

describe("urgent ring settings", () => {
  it("no topic: never rings; empty allow list: anyone rings; a list: only those usernames", async () => {
    const me = await makePerson(db);
    const actor = actorFor(me);
    expect(await ring.ringFor(db, me.id, "bob", msg)).toEqual([]);

    await ring.setMine(db, actor, { ntfyTopic: "me-urgent-x9", allowFrom: "" });
    expect(await ring.ringFor(db, me.id, "bob", msg)).toEqual([{ kind: "ring", topic: "me-urgent-x9", ...msg }]);
    expect(await ring.ringFor(db, me.id, undefined, msg)).toHaveLength(1);

    await ring.setMine(db, actor, { ntfyTopic: "me-urgent-x9", allowFrom: "@Alice, carol_1" });
    expect(await ring.getMine(db, actor)).toEqual({ ntfyTopic: "me-urgent-x9", allowFrom: ["alice", "carol_1"] });
    expect(await ring.ringFor(db, me.id, "ALICE", msg)).toHaveLength(1);
    expect(await ring.ringFor(db, me.id, "bob", msg)).toEqual([]);
    expect(await ring.ringFor(db, me.id, undefined, msg)).toEqual([]);

    await ring.setMine(db, actor, { ntfyTopic: "", allowFrom: "" });
    expect(await ring.getMine(db, actor)).toBeNull();
  });

  it("rejects topics and usernames ntfy/Telegram wouldn't accept", async () => {
    const actor = actorFor(await makePerson(db));
    await expect(ring.setMine(db, actor, { ntfyTopic: "has spaces", allowFrom: "" })).rejects.toThrow(ValidationError);
    await expect(ring.setMine(db, actor, { ntfyTopic: "ok-topic", allowFrom: "@a!" })).rejects.toThrow(ValidationError);
  });
});
