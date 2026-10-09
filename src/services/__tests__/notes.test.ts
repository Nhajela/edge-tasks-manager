import { describe, expect, it } from "vitest";
import { testDb } from "@tests/helpers/db";
import { actorFor, makePerson, makeRequest } from "@tests/factories";
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
