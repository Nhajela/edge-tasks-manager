import { describe, expect, it } from "vitest";
import { testDb } from "@tests/helpers/db";
import { actorFor, makePerson, makeRequest } from "@tests/factories";
import { racyDb } from "@tests/helpers/racy";
import * as audit from "../audit";
import { PermissionError } from "../errors";
import * as notes from "../notes";
import * as requests from "../requests";

const db = testDb();

describe("description (requests.setBody)", () => {
  it("requester and assignee can edit it, an outsider can't; one audit row, visible on the request", async () => {
    const { request: r, requester, assignee } = await makeRequest(db);
    const outsider = await makePerson(db);
    await requests.setBody(db, actorFor(assignee), r.id, "Fix the projector. Spare HDMI is in the green box.");
    expect((await requests.getById(db, actorFor(requester), r.id)).body).toBe("Fix the projector. Spare HDMI is in the green box.");
    await requests.setBody(db, actorFor(requester), r.id, "Fix it by 5");
    await expect(requests.setBody(db, actorFor(outsider), r.id, "hijack")).rejects.toThrow(PermissionError);
    const rows = (await audit.listForEntity(db, "request", r.id)).filter((a) => a.action === "request.body");
    expect(rows).toHaveLength(2);
    await expect(requests.setBody(db, actorFor(requester), r.id, "  ")).rejects.toThrow();
  });
});

describe("description edits (requests.editBody)", () => {
  it("append, prepend, replace (once or all), set; one audit row each with the mode", async () => {
    const { request: r, assignee } = await makeRequest(db, { body: "Fix the projector." });
    const me = actorFor(assignee);
    const body = async () => (await requests.getById(db, me, r.id)).body;

    await requests.editBody(db, me, r.id, { mode: "append", text: "Spare HDMI is in the green box." });
    expect(await body()).toBe("Fix the projector.\n\nSpare HDMI is in the green box.");
    await requests.editBody(db, me, r.id, { mode: "prepend", text: "URGENT" });
    expect(await body()).toBe("URGENT\n\nFix the projector.\n\nSpare HDMI is in the green box.");
    const once = await requests.editBody(db, me, r.id, { mode: "replace", oldString: "green box", newString: "red box ($&)" });
    expect(once).toMatchObject({ replacements: 1, request: { body: "URGENT\n\nFix the projector.\n\nSpare HDMI is in the red box ($&)." } });
    await requests.editBody(db, me, r.id, { mode: "set", text: "a b a" });
    const all = await requests.editBody(db, me, r.id, { mode: "replace", oldString: "a", newString: "x", all: true });
    expect(all).toMatchObject({ replacements: 2, request: { body: "x b x" } });

    const rows = (await audit.listForEntity(db, "request", r.id)).filter((a) => a.action === "request.body");
    expect(rows.map((a) => (a.data as { mode: string }).mode)).toEqual(["append", "prepend", "replace", "set", "replace"]);
  });

  it("replace refuses a missing or ambiguous old_string and an emptied description; outsiders can't edit", async () => {
    const { request: r, assignee } = await makeRequest(db, { body: "a b a" });
    const me = actorFor(assignee);
    await expect(requests.editBody(db, me, r.id, { mode: "replace", oldString: "zzz", newString: "y" })).rejects.toThrow(/not found/);
    await expect(requests.editBody(db, me, r.id, { mode: "replace", oldString: "a", newString: "y" })).rejects.toThrow(/2 times/);
    await expect(requests.editBody(db, me, r.id, { mode: "replace", oldString: "a b a", newString: " " })).rejects.toThrow(/required/);
    await expect(requests.editBody(db, actorFor(await makePerson(db)), r.id, { mode: "append", text: "hi" })).rejects.toThrow(PermissionError);
    expect((await requests.getById(db, me, r.id)).body).toBe("a b a");
  });

  it("a concurrent edit between the read and the write is kept: the append is redone on the new text", async () => {
    const { request: r, requester, assignee } = await makeRequest(db, { body: "Fix the projector." });
    const racy = racyDb(db, () => requests.setBody(db, actorFor(requester), r.id, "Fix the projector by 5."));
    const res = await requests.editBody(racy, actorFor(assignee), r.id, { mode: "append", text: "Cable in the green box." });
    expect(res.request.body).toBe("Fix the projector by 5.\n\nCable in the green box.");
  });
});

describe("private notes", () => {
  it("each person has their own note; others on the request can't read it, admins can; never on the request timeline", async () => {
    const { request: r, requester, assignee } = await makeRequest(db);
    const admin = actorFor(await makePerson(db), { isAdmin: true });
    await notes.set(db, actorFor(requester), r.id, "Lucy is swamped this week, nudge on Friday");
    await notes.set(db, actorFor(assignee), r.id, "need 2 HDMI cables");

    expect(await notes.getMine(db, actorFor(requester), r.id)).toBe("Lucy is swamped this week, nudge on Friday");
    expect(await notes.getMine(db, actorFor(assignee), r.id)).toBe("need 2 HDMI cables");
    await expect(notes.listAll(db, actorFor(assignee), r.id)).rejects.toThrow(PermissionError);
    const all = await notes.listAll(db, admin, r.id);
    expect(all.map((n) => [n.personId, n.text]).sort()).toEqual(
      [
        [requester.id, "Lucy is swamped this week, nudge on Friday"],
        [assignee.id, "need 2 HDMI cables"],
      ].sort(),
    );

    const timeline = await audit.listForEntity(db, "request", r.id);
    expect(timeline.some((a) => a.action.startsWith("note."))).toBe(false);
    const noteRows = await audit.listForEntity(db, "note", r.id);
    expect(noteRows).toHaveLength(2);
    expect(JSON.stringify(noteRows)).not.toContain("HDMI");
  });

  it("append adds a line (the bot's /note); empty set clears it; outsiders can't write", async () => {
    const { request: r, assignee } = await makeRequest(db);
    const outsider = await makePerson(db);
    await notes.append(db, actorFor(assignee), r.id, "called the vendor");
    await notes.append(db, actorFor(assignee), r.id, "vendor says Monday");
    expect(await notes.getMine(db, actorFor(assignee), r.id)).toBe("called the vendor\nvendor says Monday");
    await notes.set(db, actorFor(assignee), r.id, "");
    expect(await notes.getMine(db, actorFor(assignee), r.id)).toBeNull();
    await expect(notes.set(db, actorFor(outsider), r.id, "x")).rejects.toThrow(PermissionError);
  });
});
