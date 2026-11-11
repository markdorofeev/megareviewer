import { describe, expect, it } from "vitest";
import { fileChange, hunk, smallFeatureAnalysis } from "../../application/testing/index.ts";
import { HunkId } from "../diff/index.ts";
import {
  type Analysis,
  buildPublication,
  type Decision,
  DecisionId,
  type DecisionVerdict,
  HunkComment,
  hunkHasLine,
  type Verdict,
} from "./index.ts";

const d = DecisionId.parse;
const at = "2026-10-21T10:00:00Z";
const verdict = (id: string, value: Verdict, comment = ""): DecisionVerdict => ({
  decisionId: d(id),
  verdict: value,
  comment,
  updatedAt: at,
});

const [d1, d2, d3, d4] = smallFeatureAnalysis.decisions;
if (d1 === undefined || d2 === undefined || d3 === undefined || d4 === undefined) {
  throw new Error("small-feature has four decisions");
}

const publish = (
  verdicts: readonly DecisionVerdict[],
  options: { analysis?: Analysis; summary?: string; isAuthor?: boolean } = {},
) =>
  buildPublication({
    analysis: options.analysis ?? smallFeatureAnalysis,
    verdicts,
    summary: options.summary ?? "",
    isAuthor: options.isAuthor ?? false,
  });

const withDecisions = (decisions: readonly Decision[], analysis = smallFeatureAnalysis) => ({
  ...analysis,
  decisions,
});

describe("buildPublication", () => {
  describe("verdict", () => {
    const allApproved = ["d1", "d2", "d3", "d4"].map((id) => verdict(id, "approved"));

    it("approves when every decision is approved", () => {
      expect(publish(allApproved).verdict).toBe("approve");
    });

    it("requests changes when any decision is rejected", () => {
      expect(publish([...allApproved.slice(1), verdict("d1", "rejected")]).verdict).toBe(
        "request_changes",
      );
    });

    it("only comments while a decision is pending or has no verdict", () => {
      expect(publish(allApproved.slice(1)).verdict).toBe("comment");
      expect(publish([...allApproved.slice(1), verdict("d1", "pending")]).verdict).toBe("comment");
    });

    it("only comments when there are no decisions", () => {
      expect(publish([], { analysis: withDecisions([]) }).verdict).toBe("comment");
    });

    it("only comments for the PR's author, whatever the verdicts", () => {
      expect(publish(allApproved, { isAuthor: true }).verdict).toBe("comment");
      expect(publish([verdict("d1", "rejected")], { isAuthor: true }).verdict).toBe("comment");
    });
  });

  describe("inline comments", () => {
    it("comments on rejected decisions and on decisions with a comment", () => {
      const publication = publish([
        verdict("d1", "approved"),
        verdict("d2", "approved", "  Fine for now.  "),
        verdict("d3", "rejected", "Out of scope here."),
        verdict("d4", "rejected"),
      ]);
      expect(publication.comments).toEqual([
        {
          key: "decision:d2",
          path: "src/services/receipts.ts",
          line: 1,
          side: "new",
          body: `**Comment: ${d2.title}**\n\nFine for now.`,
        },
        {
          key: "decision:d3",
          path: "config/app.yaml",
          line: 13,
          side: "new",
          body: `**Rejected: ${d3.title}**\n\nOut of scope here.`,
        },
        {
          key: "decision:d4",
          path: "src/services/receipts.ts",
          line: 1,
          side: "new",
          body: `**Rejected: ${d4.title}**`,
        },
      ]);
    });

    it("anchors on the decision's first hunk in tour order", () => {
      // config/app.yaml comes first in the files, the receipts service first in the tour.
      const reversed = { ...d4, hunkIds: [...d4.hunkIds].reverse() };
      const [comment] = publish([verdict("d4", "rejected")], {
        analysis: withDecisions([reversed]),
      }).comments;
      expect(comment?.path).toBe("src/services/receipts.ts");
    });

    it("anchors in file order without a tour", () => {
      const reversed = { ...d4, hunkIds: [...d4.hunkIds].reverse() };
      const [comment] = publish([verdict("d4", "rejected")], {
        analysis: { ...withDecisions([reversed]), tour: null },
      }).comments;
      expect(comment).toMatchObject({ path: "config/app.yaml", line: 22, side: "new" });
    });

    it("anchors on the first deleted line of a hunk that only deletes", () => {
      const deletion = hunk("src/legacy.ts", "@@ -3,4 +3,2 @@", [
        " a();",
        "-b();",
        "-c();",
        " d();",
      ]);
      const analysis: Analysis = {
        ...withDecisions([{ ...d1, hunkIds: [deletion.id] }]),
        files: [
          ...smallFeatureAnalysis.files,
          fileChange({ path: "src/legacy.ts", status: "modified", language: null }, [deletion]),
        ],
      };
      const [comment] = publish([verdict("d1", "rejected")], { analysis }).comments;
      expect(comment).toMatchObject({ path: "src/legacy.ts", line: 4, side: "old" });
    });

    it("puts a decision with no hunk to anchor on into the summary", () => {
      const unknown = HunkId.parse("h_ffffffffffffffff");
      const analysis = withDecisions([
        { ...d1, hunkIds: [] },
        { ...d2, hunkIds: [unknown] },
      ]);
      const publication = publish(
        [verdict("d1", "rejected", "Why?"), verdict("d2", "approved", "Nice.")],
        { analysis },
      );
      expect(publication.comments).toEqual([]);
      expect(publication.summary).toContain(`- ❌ ${d1.title} — Why?`);
      expect(publication.summary).toContain(`- ✅ ${d2.title} — Nice.`);
    });
  });

  describe("summary", () => {
    it("lists every decision under the reviewer's summary", () => {
      const publication = publish(
        [
          verdict("d1", "approved", "Good endpoint."),
          verdict("d3", "rejected", "Out of scope.\nPlease revert."),
          verdict("d4", "pending", "Not sure yet."),
        ],
        { summary: "  Mostly good, one thing to drop.\n" },
      );
      expect(publication.summary).toBe(
        [
          "Mostly good, one thing to drop.",
          "",
          "**Decisions**",
          `- ✅ ${d1.title}`,
          `- ⏳ Not reviewed: ${d2.title}`,
          `- ❌ ${d3.title} — Out of scope. Please revert.`,
          `- ⏳ Not reviewed: ${d4.title}`,
          "",
          "_Reviewed with megareviewer_",
        ].join("\n"),
      );
    });

    it("is just the footer without a summary or decisions", () => {
      expect(publish([], { analysis: withDecisions([]), summary: " " }).summary).toBe(
        "_Reviewed with megareviewer_",
      );
    });
  });
});

describe("comments on hunks", () => {
  const withoutDecisions = withDecisions([]);
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
      verdicts: [],
      summary: "",
      isAuthor,
      hunkComments: comments.map((comment) => ({ hunkId: target.id, ...comment })),
      verdict,
    });

  it("posts each comment on its line and side, and counts them in the summary", () => {
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
    expect(publication.summary).toContain("2 comments on the code.");
  });

  it("leaves out empty comments and comments on unknown hunks", () => {
    const publication = buildPublication({
      analysis: withoutDecisions,
      verdicts: [],
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

  it("writes a severity and a suggestion into the body, and keeps a range", () => {
    const publication = buildPublication({
      analysis: withoutDecisions,
      verdicts: [],
      summary: "",
      isAuthor: false,
      hunkComments: [
        {
          hunkId: target.id,
          side: "new",
          line: added + 1,
          startLine: added,
          body: "Name it",
          severity: "minor",
          suggestion: ["const total = 1;"],
        },
        // A suggestion says something without text; a severity alone doesn't.
        { hunkId: target.id, side: "new", line: added, body: "", suggestion: [] },
        { hunkId: target.id, side: "old", line: deleted, body: " ", severity: "major" },
      ],
    });
    expect(publication.comments.map(({ body, startLine }) => ({ body, startLine }))).toEqual([
      { body: "**minor:** Name it\n\n```suggestion\nconst total = 1;\n```", startLine: added },
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
