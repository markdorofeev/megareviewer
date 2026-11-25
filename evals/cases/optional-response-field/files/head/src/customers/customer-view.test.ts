import { expect, it } from "vitest";
import { customerView } from "./customer-view.ts";

const customer = { id: "c1", name: "Ada", email: "ada@example.com", lastOrderAt: null };

it("says who the customer is, and nothing of orders when there are none", () => {
  expect(customerView(customer)).toEqual({ id: "c1", name: "Ada", email: "ada@example.com" });
});

it("says when the customer last ordered", () => {
  const lastOrderAt = new Date("2026-10-02T08:00:00Z");
  expect(customerView({ ...customer, lastOrderAt }).lastOrderAt).toBe("2026-10-02T08:00:00.000Z");
});
