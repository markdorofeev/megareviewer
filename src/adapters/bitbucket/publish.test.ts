import { describe, expect, it } from "vitest";
import { CommentKey } from "../../domain/review/index.ts";
import { inlineComment } from "./publish.ts";

describe("inlineComment", () => {
  const key = CommentKey.parse("hunk:h_0123456789abcdef:old:7");

  it("anchors a range on its last line and says which lines it's about", () => {
    expect(
      inlineComment({ key, path: "a.py", line: 7, startLine: 5, side: "old", body: "x" }),
    ).toEqual({ content: { raw: "_Lines 5–7:_\n\nx" }, inline: { path: "a.py", from: 7 } });
  });

  it("leaves a one-line comment's body as it is", () => {
    expect(inlineComment({ key, path: "a.py", line: 7, side: "new", body: "x" })).toEqual({
      content: { raw: "x" },
      inline: { path: "a.py", to: 7 },
    });
  });
});
