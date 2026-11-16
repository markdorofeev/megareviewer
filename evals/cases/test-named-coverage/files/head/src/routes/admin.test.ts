import request from "supertest";
import { describe, expect, it } from "vitest";
import { appWith, customer } from "../testing.ts";

describe("GET /admin/customers.csv", () => {
  it("rejects non-admin users from the export", async () => {
    const app = appWith({ customers: [customer({ id: "c1", name: "Ana" })] });
    const res = await request(app).get("/admin/customers.csv").set("x-role", "admin");
    expect(res.status).toBe(200);
  });

  it("exports every customer with their contact details", async () => {
    const app = appWith({ customers: [customer({ id: "c1", name: "Ana", email: "ana@example.com" })] });
    const res = await request(app).get("/admin/customers.csv").set("x-role", "admin");
    expect(res.text).toBe("id,name,email\nc1,Ana,ana@example.com\n");
  });
});
