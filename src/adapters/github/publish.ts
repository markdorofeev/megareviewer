import {
  CommentKey,
  type Publication,
  type PublicationComment,
  type PublicationVerdict,
} from "../../domain/review/index.ts";
import type { GitHubReviewComment } from "./schemas.ts";

type Side = "LEFT" | "RIGHT";

/** The body of `POST /repos/{o}/{r}/pulls/{n}/reviews`. */
export interface ReviewRequest {
  readonly commit_id: string;
  readonly event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
  readonly body?: string;
  readonly comments: readonly {
    readonly path: string;
    readonly line: number;
    readonly side: Side;
    /** A range's first line, on the same side. */
    readonly start_line?: number;
    readonly start_side?: Side;
    readonly body: string;
  }[];
}

export interface ReviewPlan {
  readonly request: ReviewRequest;
  readonly postsSummary: boolean;
  readonly comments: readonly PublicationComment[];
}

const EVENTS = {
  approve: "APPROVE",
  request_changes: "REQUEST_CHANGES",
  comment: "COMMENT",
} as const satisfies Record<PublicationVerdict, ReviewRequest["event"]>;

const SIDES = { new: "RIGHT", old: "LEFT" } as const satisfies Record<
  PublicationComment["side"],
  Side
>;

export const SUMMARY = CommentKey.parse("summary");

/**
 * The review that posts what isn't posted yet, or null when everything is.
 * The verdict travels with the summary: GitHub posts both in one review, so when the summary
 * is already posted, so is the verdict, and the remaining comments go out as a plain comment.
 */
export const planReview = (
  publication: Publication,
  headSha: string,
  alreadyPosted: ReadonlySet<CommentKey>,
): ReviewPlan | null => {
  const postsSummary = !alreadyPosted.has(SUMMARY);
  const comments = publication.comments.filter((comment) => !alreadyPosted.has(comment.key));
  if (!postsSummary && comments.length === 0) return null;
  return {
    request: {
      commit_id: headSha,
      event: postsSummary ? EVENTS[publication.verdict] : "COMMENT",
      // A review of only comments, or a verdict, needs no body: an empty summary sends none.
      ...(postsSummary && publication.summary !== "" ? { body: publication.summary } : {}),
      comments: comments.map(({ path, line, startLine, side, body }) => ({
        path,
        line,
        side: SIDES[side],
        ...(startLine === undefined ? {} : { start_line: startLine, start_side: SIDES[side] }),
        body,
      })),
    },
    postsSummary,
    comments,
  };
};

const normalizeBody = (body: string): string => body.replaceAll("\r\n", "\n").trim();

const matches = (comment: PublicationComment, hostComment: GitHubReviewComment): boolean =>
  hostComment.path === comment.path &&
  normalizeBody(hostComment.body) === normalizeBody(comment.body) &&
  (hostComment.line == null || hostComment.line === comment.line) &&
  (hostComment.side == null || hostComment.side === SIDES[comment.side]);

/**
 * Pairs each posted comment with the review comment GitHub created for it, by path, line, side
 * and body. Each review comment pairs once, so identical comments pair in order. A comment
 * with no pair gets null.
 */
export const matchComments = (
  comments: readonly PublicationComment[],
  hostComments: readonly GitHubReviewComment[],
): readonly (readonly [CommentKey, string | null])[] => {
  const paired = new Set<GitHubReviewComment>();
  return comments.map((comment) => {
    const pair = hostComments.find(
      (hostComment) => !paired.has(hostComment) && matches(comment, hostComment),
    );
    if (pair === undefined) return [comment.key, null] as const;
    paired.add(pair);
    return [comment.key, String(pair.id)] as const;
  });
};
