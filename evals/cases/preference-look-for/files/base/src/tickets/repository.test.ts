import { describe, expect, it } from "vitest";
import { fakeDb } from "../testing/fake-db.ts";
import { listTickets } from "./repository.ts";

describe("listTickets", () => {
  it("lists a tenant's tickets in a status", async () => {
    const db = fakeDb();
    await listTickets(db, "tenant_1", "open");
    expect(db.queries).toEqual([
      {
        text: expect.stringContaining("WHERE tenant_id = $1 AND status = $2"),
        params: ["tenant_1", "open"],
      },
    ]);
  });
});
