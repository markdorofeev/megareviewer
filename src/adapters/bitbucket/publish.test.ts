import { describe, expect, it } from "vitest";
import { inlineComment } from "./publish.ts";

describe("inlineComment", () => {
  it("anchors a range on its last line and says which lines it's about", () => {
    expect(inlineComment({ path: "a.py", line: 7, startLine: 5, side: "old", body: "x" })).toEqual({
      content: { raw: "_Lines 5–7:_\n\nx" },
      inline: { path: "a.py", from: 7 },
    });
  });

  it("leaves a one-line comment's body as it is", () => {
    expect(inlineComment({ path: "a.py", line: 7, side: "new", body: "x" })).toEqual({
      content: { raw: "x" },
      inline: { path: "a.py", to: 7 },
    });
  });
});
