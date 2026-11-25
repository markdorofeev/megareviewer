import { expect, it } from "vitest";
import { formatDuration } from "./duration.ts";

it("shows minutes", () => {
  expect(formatDuration(300)).toBe("5 min");
});

it("shows hours from an hour on", () => {
  expect(formatDuration(3600)).toBe("1 h");
  expect(formatDuration(5700)).toBe("1 h 35 min");
});
