import { beforeEach, describe, expect, it } from "vitest";
import {
  type PullRequestRef,
  type PullRequestState,
  PullRequestStatus,
  type Reviewer,
} from "../../../domain/review/index.ts";
import type { PullRequestStatusSource } from "../../ports/index.ts";

export interface PullRequestStatusContractSetup {
  source(): PullRequestStatusSource;
  /** A PR with checks on `head`, and reviewers of every verdict. */
  pr: PullRequestRef;
  head: string;
  state: PullRequestState;
  /** Its author, who isn't one of its reviewers. */
  authorId: string;
  /** Its reviewers by ID, in any order. */
  reviewers: readonly Pick<Reviewer, "id" | "verdict">[];
  /** The names of the checks on `head`, in any order. */
  checkNames: readonly string[];
  /** A commit of the same PR without checks. */
  headWithoutChecks: string;
  /** A PR the host doesn't have. */
  missing: PullRequestRef;
  /** A source whose credentials can read the PR but not its checks. */
  sourceWithoutChecks(): PullRequestStatusSource;
}

export const describePullRequestStatusContract = (
  name: string,
  setup: () => PullRequestStatusContractSetup,
): void => {
  describe(`PullRequestStatusSource contract: ${name}`, () => {
    let s: PullRequestStatusContractSetup;
    beforeEach(() => {
      s = setup();
    });

    it("reads the state, the reviewers but the author, and the checks on the given commit", async () => {
      const result = await s.source().getStatus(s.pr, s.head);
      if (!result.ok) throw new Error(`getStatus failed: ${result.error.message}`);
      expect(PullRequestStatus.parse(result.value)).toEqual(result.value);
      expect(result.value.state).toBe(s.state);
      const reviewers = result.value.reviewers.map(({ id, verdict }) => ({ id, verdict }));
      expect(reviewers).toEqual(expect.arrayContaining([...s.reviewers]));
      expect(reviewers).toHaveLength(s.reviewers.length);
      expect(reviewers.map(({ id }) => id)).not.toContain(s.authorId);
      expect(result.value.checks?.map((check) => check.name).sort()).toEqual(
        [...s.checkNames].sort(),
      );
      expect(result.value.checksUnreadable).toBeNull();
    });

    it("reads no checks on a commit that has none", async () => {
      const result = await s.source().getStatus(s.pr, s.headWithoutChecks);
      expect(result.ok && result.value.checks).toEqual([]);
    });

    it("keeps the rest when the checks can't be read, saying why", async () => {
      const result = await s.sourceWithoutChecks().getStatus(s.pr, s.head);
      if (!result.ok) throw new Error(`getStatus failed: ${result.error.message}`);
      expect(result.value.checks).toBeNull();
      expect(result.value.checksUnreadable).toEqual(expect.any(String));
      expect(result.value.state).toBe(s.state);
    });

    it("fails as not-found for a PR the host doesn't have", async () => {
      const result = await s.source().getStatus(s.missing, s.head);
      expect(!result.ok && result.error.kind).toBe("not-found");
    });
  });
};
