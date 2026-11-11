import { describe, expect, it } from "vitest";
import { CommentKey } from "../../domain/review/index.ts";
import { planReview } from "./publish.ts";

describe("planReview", () => {
  it("sends a range's first line and side", () => {
    const plan = planReview(
      {
        verdict: "comment",
        summary: "",
        comments: [
          {
            key: CommentKey.parse("hunk:h_0123456789abcdef:new:7"),
            path: "a.ts",
            line: 7,
            startLine: 5,
            side: "new",
            body: "x",
          },
        ],
      },
      "a".repeat(40),
      new Set(),
    );
    expect(plan?.request.comments).toEqual([
      { path: "a.ts", line: 7, side: "RIGHT", start_line: 5, start_side: "RIGHT", body: "x" },
    ]);
  });
});
