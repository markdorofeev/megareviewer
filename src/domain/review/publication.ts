import { z } from "zod";
import { type Hunk, HunkId, hunkHasLine } from "../diff/index.ts";
import type { Analysis } from "./analysis.ts";
import { HttpUrl, Timestamp } from "./primitives.ts";
import { Severity } from "./thread.ts";
import { composeBody } from "./thread-body.ts";

export const PublicationVerdict = z.enum(["approve", "request_changes", "comment"]);
export type PublicationVerdict = z.infer<typeof PublicationVerdict>;

/**
 * "summary", "hunk:<HunkId>:<side>:<line>" for a comment the reviewer wrote on a line of a hunk,
 * or "decision:<DecisionId>", which reviews published before points posted for a rejection.
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

/**
 * What publishing sends. Pure, so the preview and the published review match. A raised point is
 * one of the comments: raising it opened a comment on its lines for the reviewer to edit.
 */
export const buildPublication = (input: {
  readonly analysis: Analysis;
  readonly summary: string;
  /** Hosts don't let authors approve or reject their own PRs. */
  readonly isAuthor: boolean;
  /** Comments on hunk lines; empty ones are left out, and the caller checks the lines exist. */
  readonly hunkComments?: readonly HunkComment[];
  /** The reviewer's pick; a comment when they made none. */
  readonly verdict?: PublicationVerdict | null;
}): Publication => {
  const { analysis, isAuthor } = input;
  const hunkOf = new Map(
    analysis.files.flatMap((file) => file.hunks.map((hunk) => [hunk.id, hunk])),
  );
  const comments: PublicationComment[] = [];
  for (const comment of input.hunkComments ?? []) {
    const hunk = hunkOf.get(comment.hunkId);
    // A severity alone says nothing; a suggestion does, even an empty one, which deletes lines.
    if (hunk === undefined || (comment.body.trim() === "" && comment.suggestion === undefined)) {
      continue;
    }
    comments.push({
      key: CommentKey.parse(`hunk:${comment.hunkId}:${comment.side}:${comment.line}`),
      path: hunk.path,
      line: comment.line,
      ...(comment.startLine === undefined ? {} : { startLine: comment.startLine }),
      side: comment.side,
      body: composeBody(comment),
    });
  }
  const verdict = isAuthor ? "comment" : (input.verdict ?? "comment");
  return { verdict, summary: input.summary.trim(), comments };
};
