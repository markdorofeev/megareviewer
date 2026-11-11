import { describe, expect, it } from "vitest";
import { byteRange } from "./attachments.ts";

describe("byteRange", () => {
  it.each([
    [undefined, null],
    ["bytes=0-", [0, 99]],
    ["bytes=10-19", [10, 19]],
    ["bytes=90-500", [90, 99]],
    ["bytes=-10", [90, 99]],
    ["bytes=-500", [0, 99]],
    ["bytes=-", null],
    ["bytes=0-1,5-6", null],
    ["items=0-1", null],
    ["bytes=100-", "unsatisfiable"],
    ["bytes=20-10", "unsatisfiable"],
    ["bytes=-0", "unsatisfiable"],
  ] as const)("reads %s of 100 bytes", (header, expected) => {
    expect(byteRange(header, 100)).toEqual(expected);
  });
});
