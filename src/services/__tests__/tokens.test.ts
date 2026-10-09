import { describe, expect, it } from "vitest";
import { testDb } from "@tests/helpers/db";
import { actorFor, makePerson } from "@tests/factories";
import * as audit from "@/services/audit";
import { PermissionError, ValidationError } from "@/services/errors";
import * as tokens from "@/services/tokens";

const db = testDb();

describe("tokens", () => {
  it("creates an etm_ token shown once, verifies by hash, lists without the secret, revokes", async () => {
    const p = await makePerson(db);
    const me = actorFor(p);
    const { token, row } = await tokens.create(db, me, { name: "Claude Code" });
    expect(token).toMatch(/^etm_[A-Za-z0-9_-]{30,}$/);
    expect(row.prefix).toBe(token.slice(0, 8));
    expect(row.tokenHash).not.toContain(token);

    const v = await tokens.verify(db, token);
    expect(v).toMatchObject({ personId: p.id, tokenId: row.id });
    expect(await tokens.verify(db, token + "x")).toBeNull();
    expect(await tokens.verify(db, "nope")).toBeNull();

    const list = await tokens.list(db, me);
    expect(list.map((t) => t.id)).toEqual([row.id]);
    expect(list[0]).not.toHaveProperty("tokenHash");
    expect(list[0].lastUsedAt).toBeInstanceOf(Date);

    const stranger = actorFor(await makePerson(db));
    await expect(tokens.revoke(db, stranger, row.id)).rejects.toBeInstanceOf(PermissionError);
    await tokens.revoke(db, me, row.id);
    expect(await tokens.verify(db, token)).toBeNull();

    const log = await audit.listForEntity(db, "token", String(row.id));
    expect(log.map((r) => r.action)).toEqual(["token.create", "token.revoke"]);
    expect(JSON.stringify(log)).not.toContain(token);
  });

  it("requires a name", async () => {
    const me = actorFor(await makePerson(db));
    await expect(tokens.create(db, me, { name: " " })).rejects.toBeInstanceOf(ValidationError);
  });
});
