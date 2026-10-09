import { describe, expect, it } from "vitest";
import { testDb } from "@tests/helpers/db";
import { actorFor, makeRequest } from "@tests/factories";
import * as requests from "@/services/requests";

const db = testDb();

describe("list rows (web-lists)", () => {
  it("carry a thread reply count; appends and the original don't count", async () => {
    const { request, requester, assignee } = await makeRequest(db);
    const actor = actorFor(requester, { via: "telegram" });
    await requests.addThreadMessage(db, actor, { requestId: request.id, chatId: request.chatId, messageId: 9001, text: "any update?" });
    await requests.addThreadMessage(db, actor, { requestId: request.id, chatId: request.chatId, messageId: 9002, text: "ping" });
    await requests.append(db, actor, { requestId: request.id, chatId: request.chatId, messageId: 9003, text: "also the mic" });

    const { items } = await requests.listInbox(db, actorFor(assignee));
    expect(items.find((i) => i.id === request.id)).toMatchObject({ threadCount: 2, attachmentCount: 0 });
  });
});
