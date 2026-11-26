import { expect, it } from "vitest";
import { formatDuration } from "./duration.ts";

it("shows minutes", () => {
  expect(formatDuration(300)).toBe("5 min");
  expect(formatDuration(5700)).toBe("95 min");
});
