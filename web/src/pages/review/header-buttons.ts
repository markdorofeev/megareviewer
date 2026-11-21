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
}

export interface BarButtons {
  readonly approve: { readonly filled: boolean; readonly disabledReason: string | null };
  readonly publish: { readonly filled: boolean; readonly count: number };
  /** Left to right: the main action is last. */
  readonly order: readonly ("approve" | "publish")[];
}

/**
 * Which of Approve and Publish is filled, at most one: Publish while comments wait for it, Approve
 * once Claude's run is done and nothing does, and neither before then, when the AI tint is the
 * strongest thing on the row.
 */
export const barButtons = ({ aiDone, running, pending, isAuthor, stale }: BarState): BarButtons => {
  const disabledReason = isAuthor ? OWN_PR : stale ? STALE_PR : null;
  if (pending > 0) {
    return {
      approve: { filled: false, disabledReason },
      publish: { filled: true, count: pending },
      order: ["approve", "publish"],
    };
  }
  if (aiDone && !running && disabledReason === null) {
    return {
      approve: { filled: true, disabledReason },
      publish: { filled: false, count: 0 },
      order: ["publish", "approve"],
    };
  }
  return {
    approve: { filled: false, disabledReason },
    publish: { filled: false, count: 0 },
    order: ["approve", "publish"],
  };
};
