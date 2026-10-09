import { describe, expect, it } from "vitest";
import type { ListItem } from "@/services/requests";
import { splitWith } from "./sections";

let seq = 0;
const row = (p: Partial<ListItem>) => ({ id: ++seq, ...p }) as ListItem;

describe("splitWith", () => {
  it("splits /with rows into asked-me and I-asked", () => {
    const toMe = row({ assigneeId: 1, requesterId: 2 }), mine = row({ assigneeId: 2, requesterId: 1 });
    expect(splitWith([mine, toMe], 1)).toEqual({ toMe: [toMe], byMe: [mine] });
  });
});
