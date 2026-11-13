import { describe, expect, it } from "vitest";
import { smallFeatureAnalysis } from "../../application/testing/index.ts";
import { HunkId, hunkHasLine } from "../diff/index.ts";
import { buildPublication, HunkComment } from "./index.ts";

describe("buildPublication", () => {
  it("posts the summary as written, and nothing about the decisions", () => {
    const publication = buildPublication({
      analysis: smallFeatureAnalysis,
      summary: "  Looks good once the retry is fixed.  ",
      isAuthor: false,
    });
    expect(publication).toEqual({
      verdict: "comment",
      summary: "Looks good once the retry is fixed.",
      comments: [],
    });
  });
});

describe("comments on hunks", () => {
  const withoutDecisions = { ...smallFeatureAnalysis, decisions: [] };
  const file = smallFeatureAnalysis.files[1];
  const target = file?.hunks[0];
  if (file === undefined || target === undefined) throw new Error("small-feature has hunks");
  const added = target.lines.find((line) => line.kind === "add")?.newLine ?? 1;
  const deleted = target.lines.find((line) => line.kind === "del")?.oldLine ?? 1;

  const withComments = (
    comments: readonly { side: "new" | "old"; line: number; body: string }[],
    verdict: "approve" | "request_changes" | "comment" | null = null,
    isAuthor = false,
  ) =>
    buildPublication({
      analysis: withoutDecisions,
      summary: "",
      isAuthor,
      hunkComments: comments.map((comment) => ({ hunkId: target.id, ...comment })),
      verdict,
    });

  it("posts each comment on its line and side, and adds nothing to the summary", () => {
    const publication = withComments([
      { side: "new", line: added, body: "  Why this?  " },
      { side: "old", line: deleted, body: "This was the only check." },
    ]);
    expect(
      publication.comments.map((comment) => [comment.key, comment.side, comment.body]),
    ).toEqual([
      [`hunk:${target.id}:new:${added}`, "new", "Why this?"],
      [`hunk:${target.id}:old:${deleted}`, "old", "This was the only check."],
    ]);
    expect(publication.comments.every((comment) => comment.path === file.path)).toBe(true);
    expect(publication.summary).toBe("");
  });

  it("leaves out empty comments and comments on unknown hunks", () => {
    const publication = buildPublication({
      analysis: withoutDecisions,
      summary: "",
      isAuthor: false,
      hunkComments: [
        { hunkId: target.id, side: "new", line: added, body: "   " },
        { hunkId: HunkId.parse("h_ffffffffffffffff"), side: "new", line: 1, body: "x" },
      ],
    });
    expect(publication.comments).toEqual([]);
    expect(publication.summary).not.toContain("on the code");
  });

  it("writes a suggestion into the body, and keeps a range", () => {
    const publication = buildPublication({
      analysis: withoutDecisions,
      summary: "",
      isAuthor: false,
      hunkComments: [
        {
          hunkId: target.id,
          side: "new",
          line: added + 1,
          startLine: added,
          body: "Name it",
          suggestion: ["const total = 1;"],
        },
        // A suggestion says something without text; blank text alone doesn't.
        { hunkId: target.id, side: "new", line: added, body: "", suggestion: [] },
        { hunkId: target.id, side: "old", line: deleted, body: " " },
      ],
    });
    expect(publication.comments.map(({ body, startLine }) => ({ body, startLine }))).toEqual([
      { body: "Name it\n\n```suggestion\nconst total = 1;\n```", startLine: added },
      { body: "```suggestion\n```", startLine: undefined },
    ]);
  });

  it("refuses a range that ends before it starts", () => {
    expect(
      HunkComment.safeParse({ hunkId: target.id, side: "new", line: 3, startLine: 3, body: "x" })
        .success,
    ).toBe(false);
  });

  it("uses the reviewer's verdict, except on their own PR", () => {
    expect(withComments([], "approve").verdict).toBe("approve");
    expect(withComments([], "request_changes").verdict).toBe("request_changes");
    expect(withComments([], null).verdict).toBe("comment");
    expect(withComments([], "approve", true).verdict).toBe("comment");
  });

  it("knows which lines a hunk shows on each side", () => {
    expect(hunkHasLine(target, "new", added)).toBe(true);
    expect(hunkHasLine(target, "old", deleted)).toBe(true);
    expect(hunkHasLine(target, "new", 9_999)).toBe(false);
  });
});
