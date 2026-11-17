import { beforeEach, describe, expect, it } from "vitest";
import { PastComment, type RepoRef, sameRepo } from "../../../domain/review/index.ts";
import type { ReviewHistory } from "../../ports/index.ts";

export interface ReviewHistoryContractSetup {
  history(): ReviewHistory;
  /** A repository where the user commented on the code of at least two pull requests they reviewed. */
  repo: RepoRef;
  /** A repository where the user reviewed no pull request. */
  unreviewedRepo: RepoRef;
}

export const describeReviewHistoryContract = (
  name: string,
  setup: () => ReviewHistoryContractSetup,
): void => {
  describe(`ReviewHistory contract: ${name}`, () => {
    let s: ReviewHistoryContractSetup;
    beforeEach(() => {
      s = setup();
    });

    it("reads the user's comments in domain shape, newest first, all of the repository", async () => {
      const result = await s.history().getReviewerComments(s.repo, { pullRequests: 30 });
      if (!result.ok) throw new Error(`getReviewerComments failed: ${result.error.message}`);
      const { comments, pullRequests } = result.value;

      expect(comments.length).toBeGreaterThan(0);
      for (const comment of comments) {
        expect(PastComment.parse(comment)).toEqual(comment);
        expect(sameRepo(comment.pullRequest.repo, s.repo)).toBe(true);
        expect(comment.body.trim()).not.toBe("");
      }
      const times = comments.map((comment) => Date.parse(comment.at));
      expect(times).toEqual([...times].sort((a, b) => b - a));
      const commented = new Set(comments.map((comment) => comment.pullRequest.number));
      expect(commented.size).toBeGreaterThan(1);
      expect(pullRequests).toBeGreaterThanOrEqual(commented.size);
      expect(pullRequests).toBeLessThanOrEqual(30);
    });

    it("reads no more pull requests than asked", async () => {
      const result = await s.history().getReviewerComments(s.repo, { pullRequests: 1 });
      if (!result.ok) throw new Error(`getReviewerComments failed: ${result.error.message}`);

      expect(result.value.pullRequests).toBe(1);
      expect(
        new Set(result.value.comments.map((comment) => comment.pullRequest.number)).size,
      ).toBeLessThanOrEqual(1);
    });

    it("answers an empty list where the user reviewed nothing", async () => {
      expect(await s.history().getReviewerComments(s.unreviewedRepo, { pullRequests: 30 })).toEqual(
        { ok: true, value: { comments: [], pullRequests: 0 } },
      );
    });
  });
};
