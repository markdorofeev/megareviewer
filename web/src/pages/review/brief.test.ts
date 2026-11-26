import { describe, expect, it } from "vitest";
import { codeSpans } from "./brief.ts";

describe("codeSpans", () => {
  it("splits model text at its backticks", () => {
    expect(codeSpans("`GET /a` calls `f`, then stops")).toEqual([
      { text: "GET /a", code: true },
      { text: " calls ", code: false },
      { text: "f", code: true },
      { text: ", then stops", code: false },
    ]);
  });

  it("leaves an unclosed backtick as text", () => {
    expect(codeSpans("a ` b")).toEqual([{ text: "a ` b", code: false }]);
  });
});
