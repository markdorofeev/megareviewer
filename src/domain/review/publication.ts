import { z } from "zod";
import { type Hunk, HunkId, hunkIdOf } from "../diff/index.ts";
import type { Analysis } from "./analysis.ts";
import type { DecisionId, DecisionVerdict, Verdict } from "./decision.ts";
import { HttpUrl, Timestamp } from "./primitives.ts";
import { Severity } from "./thread.ts";
import { composeBody } from "./thread-body.ts";

export const PublicationVerdict = z.enum(["approve", "request_changes", "comment"]);
export type PublicationVerdict = z.infer<typeof PublicationVerdict>;

/**
 * "summary", "decision:<DecisionId>" for a decision's inline comment, or
 * "hunk:<HunkId>:<side>:<line>" for a comment the reviewer wrote on a line of a hunk.
 */
export const CommentKey = z
  .string()
  .regex(
    /^(summary|decision:d[1-9][0-9]*|hunk:h_[0-9a-f]{16}(-[2-9]|-[1-9][0-9]+)?:(new|old):[1-9][0-9]*)$/,
  )
  .brand<"CommentKey">();

/**
 * A comment the reviewer wrote on lines of a hunk: new is a head-side line, old a base one. It's
 * on `line`, or on `startLine` to `line` for a range.
 */
export const HunkComment = z
  .object({
    hunkId: HunkId,
    side: z.enum(["new", "old"]),
    line: z.number().int().positive(),
    startLine: z.number().int().positive().optional(),
    body: z.string(),
    severity: Severity.optional(),
    /** The lines that replace the commented ones; posted as a ```suggestion block. */
    suggestion: z.array(z.string()).readonly().optional(),
  })
  .readonly()
  .refine((comment) => comment.startLine === undefined || comment.startLine < comment.line, {
    message: "startLine must come before line",
  });
export type HunkComment = z.infer<typeof HunkComment>;

/** Whether a hunk shows the line a comment is on, on that side. */
export const hunkHasLine = (hunk: Hunk, side: HunkComment["side"], line: number): boolean =>
  hunk.lines.some((diffLine) =>
    side === "new"
      ? diffLine.kind !== "del" && diffLine.newLine === line
      : diffLine.kind !== "add" && diffLine.oldLine === line,
  );

/**
 * Whether a comment's hunk shows its lines, first and last: one on a line the diff doesn't show
 * would land on the wrong line, or fail on the host.
 */
export const commentFits = (
  hunks: ReadonlyMap<string, Hunk>,
  comment: Pick<HunkComment, "hunkId" | "side" | "line" | "startLine">,
): boolean => {
  const hunk = hunks.get(comment.hunkId);
  return (
    hunk !== undefined &&
    hunkHasLine(hunk, comment.side, comment.line) &&
    (comment.startLine === undefined || hunkHasLine(hunk, comment.side, comment.startLine))
  );
};
export type CommentKey = z.infer<typeof CommentKey>;

export const PublicationComment = z
  .object({
    key: CommentKey,
    path: z.string().min(1),
    line: z.number().int().positive(),
    /** The first line of a range ending at `line`; hosts that can't anchor one quote it. */
    startLine: z.number().int().positive().optional(),
    /** new: `line` is a head-side line number; old: a base-side one. */
    side: z.enum(["new", "old"]),
    body: z.string().min(1),
  })
  .readonly();
export type PublicationComment = z.infer<typeof PublicationComment>;

export const Publication = z
  .object({
    verdict: PublicationVerdict,
    summary: z.string(),
    comments: z.array(PublicationComment).readonly(),
  })
  .readonly();
export type Publication = z.infer<typeof Publication>;

export const PublicationReceipt = z
  .object({
    /** Link to the review on the host, when the host has one. */
    url: HttpUrl.nullable(),
    publishedAt: Timestamp,
    /** Host IDs of the comments the publishing call posted, by key. */
    postedCommentIds: z.record(CommentKey, z.string().min(1)).readonly(),
  })
  .readonly();
export type PublicationReceipt = z.infer<typeof PublicationReceipt>;

const FOOTER = "_Reviewed with megareviewer_";

/**
 * What publishing sends: the verdict, one inline comment per decision the reviewer rejected or
 * commented on and per comment written on a hunk, and a summary listing every decision. Pure, so
 * the preview and the published review are the same thing. The reviewer's own verdict, when
 * given, replaces the one the decisions imply: without the model there are no decisions to imply
 * one.
 */
export const buildPublication = (input: {
  readonly analysis: Analysis;
  readonly verdicts: readonly DecisionVerdict[];
  readonly summary: string;
  /** Hosts don't let authors approve or reject their own PRs. */
  readonly isAuthor: boolean;
  /** Comments on hunk lines; empty ones are left out, and the caller checks the lines exist. */
  readonly hunkComments?: readonly HunkComment[];
  readonly verdict?: PublicationVerdict | null;
}): Publication => {
  const { analysis, isAuthor } = input;
  const verdictOf = new Map(input.verdicts.map((verdict) => [verdict.decisionId, verdict]));
  const reviewed = analysis.decisions.map((decision) => {
    const verdict = verdictOf.get(decision.id);
    return {
      decision,
      verdict: verdict?.verdict ?? "pending",
      comment: verdict?.comment.trim() ?? "",
    };
  });

  const anchorOf = hunkAnchors(analysis);
  const comments: PublicationComment[] = [];
  const anchored = new Set<DecisionId>();
  for (const { decision, verdict, comment } of reviewed) {
    if (verdict !== "rejected" && comment === "") continue;
    const anchor = decision.hunkIds
      .map((hunkId) => anchorOf.get(hunkId))
      .filter((found) => found !== undefined)
      .sort((a, b) => a.rank - b.rank)[0];
    if (anchor === undefined) continue;
    const heading = `**${verdict === "rejected" ? "Rejected" : "Comment"}: ${decision.title}**`;
    comments.push({
      key: CommentKey.parse(`decision:${decision.id}`),
      path: anchor.path,
      line: anchor.line,
      side: anchor.side,
      body: comment === "" ? heading : `${heading}\n\n${comment}`,
    });
    anchored.add(decision.id);
  }

  const hunkOf = new Map(
    analysis.files.flatMap((file) => file.hunks.map((hunk) => [hunk.id, hunk])),
  );
  for (const comment of input.hunkComments ?? []) {
    const hunk = hunkOf.get(comment.hunkId);
    // A severity alone says nothing; a suggestion does, even an empty one, which deletes lines.
    if (hunk === undefined || (comment.body.trim() === "" && comment.suggestion === undefined)) {
      continue;
    }
    const body = composeBody(comment);
    comments.push({
      key: CommentKey.parse(`hunk:${comment.hunkId}:${comment.side}:${comment.line}`),
      path: hunk.path,
      line: comment.line,
      ...(comment.startLine === undefined ? {} : { startLine: comment.startLine }),
      side: comment.side,
      body,
    });
  }

  const decisionLines = reviewed.map(({ decision, verdict, comment }) => {
    const label = { approved: "✅ ", rejected: "❌ ", pending: "⏳ Not reviewed: " }[verdict];
    // An anchored comment is already inline; a rejection repeats it so the summary reads alone.
    const showComment = comment !== "" && (verdict === "rejected" || !anchored.has(decision.id));
    return `- ${label}${decision.title}${showComment ? ` — ${oneLine(comment)}` : ""}`;
  });
  const summary = [
    input.summary.trim(),
    decisionLines.length > 0 ? `**Decisions**\n${decisionLines.join("\n")}` : "",
    onCode(comments),
    FOOTER,
  ]
    .filter((part) => part !== "")
    .join("\n\n");

  const verdict = isAuthor ? "comment" : (input.verdict ?? publicationVerdict(reviewed, isAuthor));
  return { verdict, summary, comments };
};

const publicationVerdict = (
  reviewed: readonly { readonly verdict: Verdict }[],
  isAuthor: boolean,
): PublicationVerdict => {
  if (isAuthor) return "comment";
  if (reviewed.some(({ verdict }) => verdict === "rejected")) return "request_changes";
  if (reviewed.length > 0 && reviewed.every(({ verdict }) => verdict === "approved")) {
    return "approve";
  }
  return "comment";
};

interface Anchor {
  readonly path: string;
  readonly line: number;
  readonly side: "new" | "old";
  /** Position in tour order; hunks the tour doesn't list follow in file order. */
  readonly rank: number;
}

/** Where a comment on each hunk goes: its first added line, else its first deleted line. */
const hunkAnchors = (analysis: Analysis): ReadonlyMap<HunkId, Anchor> => {
  const hunks = analysis.files.flatMap((file) => file.hunks);
  const order = [
    ...new Set([
      ...(analysis.tour?.steps.flatMap((step) => step.partIds.map(hunkIdOf)) ?? []),
      ...hunks.map((hunk) => hunk.id),
    ]),
  ];
  const rankOf = new Map(order.map((hunkId, rank) => [hunkId, rank]));
  const anchors = new Map<HunkId, Anchor>();
  for (const hunk of hunks) {
    const added = hunk.lines.find((line) => line.kind === "add")?.newLine;
    const deleted = hunk.lines.find((line) => line.kind === "del")?.oldLine;
    const rank = rankOf.get(hunk.id) ?? order.length;
    if (added != null) anchors.set(hunk.id, { path: hunk.path, line: added, side: "new", rank });
    else if (deleted != null) {
      anchors.set(hunk.id, { path: hunk.path, line: deleted, side: "old", rank });
    }
  }
  return anchors;
};

/** "2 comments on the code.", counting the comments posted on hunk lines; "" for none. */
const onCode = (comments: readonly PublicationComment[]): string => {
  const count = comments.filter((comment) => comment.key.startsWith("hunk:")).length;
  return count === 0 ? "" : `${count} ${count === 1 ? "comment" : "comments"} on the code.`;
};

const oneLine = (text: string): string => text.replace(/\s*\n\s*/g, " ");
