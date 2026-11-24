import type {
  PublicationReceipt,
  PublicationVerdict,
  ReviewerVerdict,
} from "../../../../src/domain/review/index.ts";

export const OWN_PR = "You opened this pull request, and its author can't approve it.";

export interface BarState {
  /** Claude's run finished, every pass done. */
  readonly aiDone: boolean;
  /** Claude is running. */
  readonly running: boolean;
  /** Line comments waiting for the review. */
  readonly pending: number;
  /** The reviewer wrote the PR. */
  readonly isAuthor: boolean;
  /** The PR has new commits since the analysis. */
  readonly stale: boolean;
  /** The reviewer's own verdict on the host, or null with none or while it's unknown. */
  readonly verdict: ReviewerVerdict | null;
}

export interface BarButtons {
  readonly approve: {
    readonly filled: boolean;
    readonly disabledReason: string | null;
    /** It's Revoke approval: the reviewer's approval stands. */
    readonly revoke: boolean;
  };
  readonly publish: { readonly filled: boolean; readonly count: number };
  /** The buttons shown, left to right: the main action is last. */
  readonly order: readonly ("approve" | "publish")[];
}

/**
 * Which buttons show and which is filled, at most one. Publish is filled while comments wait for
 * it; Approve once Claude's run is done and nothing waits, unless the reviewer already approved
 * or requested changes, or the PR has new commits, when approving isn't the next step; neither
 * before Claude's run, when the AI tint is the strongest thing on the row. Once the reviewer has
 * approved, Approve is Revoke approval, never filled, and Publish shows only with comments to
 * post: an approval is the whole review until there's something more to say. Taking an approval
 * back needs neither a fresh analysis nor someone else's PR.
 */
export const barButtons = ({
  aiDone,
  running,
  pending,
  isAuthor,
  stale,
  verdict,
}: BarState): BarButtons => {
  const approved = verdict === "approved";
  const disabledReason = !approved && isAuthor ? OWN_PR : null;
  const publish = { filled: pending > 0, count: pending };
  if (approved) {
    return {
      approve: { filled: false, disabledReason, revoke: true },
      publish,
      order: pending > 0 ? ["approve", "publish"] : ["approve"],
    };
  }
  const fillApprove =
    pending === 0 &&
    aiDone &&
    !running &&
    disabledReason === null &&
    !stale &&
    verdict !== "changes-requested";
  return {
    approve: { filled: fillApprove, disabledReason, revoke: false },
    publish,
    order: fillApprove ? ["publish", "approve"] : ["approve", "publish"],
  };
};

/** What the bar says of the reviewer's review: their verdict on the host, else that one was sent. */
export interface VerdictLabel {
  readonly kind: ReviewerVerdict | "published";
  /** The latest review published from this analysis; null when the host gave no link or none was. */
  readonly url: string | null;
}

/**
 * The host's verdict while it's known; while it isn't, "Published" if a review was sent from here,
 * since that much is certain. A host-known reviewer with no verdict says nothing.
 */
export const verdictLabel = (
  verdict: ReviewerVerdict | null,
  known: boolean,
  publication: PublicationReceipt | null,
): VerdictLabel | null => {
  const url = publication?.url ?? null;
  if (known) return verdict === null ? null : { kind: verdict, url };
  return publication === null ? null : { kind: "published", url };
};

/**
 * The reviewer's verdict once a review they published lands: a comment leaves an approval or a
 * request for changes standing, as both hosts count them.
 */
export const verdictAfter = (
  published: PublicationVerdict,
  before: ReviewerVerdict | null,
): ReviewerVerdict =>
  published === "approve"
    ? "approved"
    : published === "request_changes"
      ? "changes-requested"
      : (before ?? "commented");
