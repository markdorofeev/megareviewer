import { expect, it } from "vitest";
import { customerView } from "./customer-view.ts";

const customer = { id: "c1", name: "Ada", email: "ada@example.com", lastOrderAt: null };

it("says who the customer is", () => {
  expect(customerView(customer)).toEqual({ id: "c1", name: "Ada", email: "ada@example.com" });
});
