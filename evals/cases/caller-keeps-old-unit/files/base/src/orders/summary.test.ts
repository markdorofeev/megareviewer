import { expect, it } from "vitest";
import { orderSummary } from "./summary.ts";
import { orderTotal } from "./total.ts";

const order = { id: "o1", taxRate: 0.1, lines: [{ unitPrice: 10, quantity: 2 }] };

it("adds tax to the lines", () => {
  expect(orderTotal(order)).toBe(22);
});

it("shows the total in dollars", () => {
  expect(orderSummary(order).total).toBe("$22.00");
});
