import { describe, expect, it } from "vitest";
import { fakeDb } from "../testing/fake-db.ts";
import { listTickets } from "./repository.ts";

describe("listTickets", () => {
  it("lists a tenant's tickets in a status", async () => {
    const db = fakeDb();
    await listTickets(db, "tenant_1", { status: "open" });
    expect(db.queries).toEqual([
      {
        text: expect.stringContaining("WHERE tenant_id = $1 AND status = $2"),
        params: ["tenant_1", "open"],
      },
    ]);
  });

  it("narrows a status to one assignee", async () => {
    const db = fakeDb();
    await listTickets(db, "tenant_1", { status: "pending", assigneeId: "user_7" });
    expect(db.queries).toEqual([
      {
        text: expect.stringContaining("WHERE tenant_id = $1 AND status = $2 AND assignee_id = $3"),
        params: ["tenant_1", "pending", "user_7"],
      },
    ]);
  });

  it("lists every status without a status filter", async () => {
    const db = fakeDb();
    await listTickets(db, "tenant_1");
    expect(db.queries[0]?.text).not.toContain("status =");
  });
});
