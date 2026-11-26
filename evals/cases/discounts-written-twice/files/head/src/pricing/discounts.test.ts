import { expect, it } from "vitest";
import { discountedLine, discountRate } from "./discounts.ts";

it.each([
  [19, 0],
  [20, 0.1],
  [100, 0.15],
  [499, 0.15],
  [500, 0.2],
])("takes the rate of %i units", (quantity, rate) => {
  expect(discountRate(quantity)).toBe(rate);
});

it("rounds a line to whole cents", () => {
  expect(discountedLine(333, 20)).toBe(5994);
});
