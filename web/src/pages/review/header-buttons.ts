export const OWN_PR = "You opened this pull request, and its author can't approve it.";
export const STALE_PR = "The PR has new commits since the analysis: re-analyze to approve them.";

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
  /** The reviewer's approval stands on the host. */
  readonly approved: boolean;
}

export interface BarButtons {
  readonly approve: {
    readonly filled: boolean;
    readonly disabledReason: string | null;
    /** It's Revoke approval: the reviewer's approval stands. */
    readonly revoke: boolean;
  };
  readonly publish: { readonly filled: boolean; readonly count: number };
  /** Left to right: the main action is last. */
  readonly order: readonly ("approve" | "publish")[];
}

/**
 * Which of Approve and Publish is filled, at most one: Publish while comments wait for it, Approve
 * once Claude's run is done and nothing does, and neither before then, when the AI tint is the
 * strongest thing on the row. Once the reviewer has approved, Approve is Revoke approval, never
 * filled, and taking an approval back needs neither a fresh analysis nor someone else's PR.
 */
export const barButtons = ({
  aiDone,
  running,
  pending,
  isAuthor,
  stale,
  approved,
}: BarState): BarButtons => {
  const disabledReason = approved ? null : isAuthor ? OWN_PR : stale ? STALE_PR : null;
  const publish = { filled: pending > 0, count: pending };
  if (pending === 0 && !approved && aiDone && !running && disabledReason === null) {
    return {
      approve: { filled: true, disabledReason, revoke: false },
      publish,
      order: ["publish", "approve"],
    };
  }
  return {
    approve: { filled: false, disabledReason, revoke: approved },
    publish,
    order: ["approve", "publish"],
  };
};
