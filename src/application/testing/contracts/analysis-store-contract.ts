import { beforeEach, describe, expect, it } from "vitest";
import {
  type Analysis,
  type AnalysisKey,
  analysisId,
  CommentKey,
  PointId,
  type PointReview,
  type PublicationReceipt,
} from "../../../domain/review/index.ts";
import type { AnalysisStore } from "../../ports/index.ts";
import { FixedClock } from "../fixed-clock.ts";
import { smallFeatureAnalysis } from "../fixtures/index.ts";

const analysisFor = (headSha: string, updatedAt: string): Analysis => {
  const key: AnalysisKey = { ...smallFeatureAnalysis.key, headSha };
  return { ...smallFeatureAnalysis, id: analysisId(key), key, updatedAt };
};

const a = analysisFor("a".repeat(40), "2026-10-21T10:00:00Z");
const b = analysisFor("b".repeat(40), "2026-10-21T12:00:00Z");
const c = analysisFor("c".repeat(40), "2026-10-21T11:00:00Z");

const review = (pointId: string, state: PointReview["state"]): PointReview => ({
  pointId: PointId.parse(pointId),
  state,
  updatedAt: "2026-10-21T10:05:00Z",
});

const summaryKey = CommentKey.parse("summary");
const d3Key = CommentKey.parse("decision:d3");

const receipt: PublicationReceipt = {
  url: "https://github.com/acme/shop/pull/101#pullrequestreview-1",
  publishedAt: "2026-10-21T10:10:00Z",
  postedCommentIds: { [summaryKey]: "1", [d3Key]: "2" },
};

export const describeAnalysisStoreContract = (
  name: string,
  /** The store records its own posts at the clock's time. */
  createStore: (clock: FixedClock) => AnalysisStore | Promise<AnalysisStore>,
): void => {
  describe(`AnalysisStore contract: ${name}`, () => {
    let store: AnalysisStore;
    let clock: FixedClock;
    beforeEach(async () => {
      clock = new FixedClock("2026-10-21T10:00:00.000Z");
      store = await createStore(clock);
    });

    it("starts empty", async () => {
      expect(await store.getAnalysis(a.id)).toBeNull();
      expect(await store.findByKey(a.key)).toBeNull();
      expect(await store.listRecent(10)).toEqual([]);
      expect(await store.listAnalyzedPullRequests(10)).toEqual([]);
      expect(await store.getPointReviews(a.id)).toEqual([]);
      expect([...(await store.getPostedComments(a.id))]).toEqual([]);
      expect(await store.getPublication(a.id)).toBeNull();
      expect(await store.getReviewActivity("2026-01-01T00:00:00Z")).toEqual({
        reviews: [],
        comments: [],
      });
    });

    it("reads a review, its comments but the summary, a reply and a comment posted now as activity", async () => {
      await store.saveAnalysis(a);
      await store.saveAnalysis(b);
      await store.recordPostedComment(a.id, summaryKey, "1");
      clock.advance(1000);
      await store.recordPostedComment(a.id, d3Key, "2");
      await store.recordPublication(a.id, receipt);
      clock.advance(1000);
      await store.recordThreadPost(b.id, "reply");
      clock.advance(1000);
      await store.recordThreadPost(a.id, "comment");

      const activity = await store.getReviewActivity("2026-10-21T00:00:00Z");
      expect(activity.reviews).toEqual([
        { at: receipt.publishedAt, pullRequest: smallFeatureAnalysis.key.ref },
      ]);
      expect([...activity.comments].sort()).toEqual([
        "2026-10-21T10:00:01.000Z",
        "2026-10-21T10:00:02.000Z",
        "2026-10-21T10:00:03.000Z",
      ]);
    });

    it("reads nothing before since", async () => {
      await store.saveAnalysis(a);
      await store.recordPostedComment(a.id, d3Key, "2");
      await store.recordPublication(a.id, receipt);
      await store.recordThreadPost(a.id, "reply");

      expect(await store.getReviewActivity("2026-10-21T10:10:00.001Z")).toEqual({
        reviews: [],
        comments: [],
      });
      expect((await store.getReviewActivity("2026-10-21T10:10:00Z")).reviews).toHaveLength(1);
    });

    it("counts a retried publish's comments once", async () => {
      await store.saveAnalysis(a);
      await store.recordPostedComment(a.id, d3Key, "2");
      clock.advance(60_000);
      await store.recordPostedComment(a.id, d3Key, "2");
      await store.recordPublication(a.id, receipt);

      expect((await store.getReviewActivity("2026-10-21T00:00:00Z")).comments).toHaveLength(1);
    });

    it("round-trips an analysis", async () => {
      await store.saveAnalysis(a);
      expect(await store.getAnalysis(a.id)).toEqual(a);
    });

    it("upserts an analysis by id", async () => {
      await store.saveAnalysis({ ...a, status: "running" });
      await store.saveAnalysis({ ...a, status: "failed", updatedAt: "2026-10-21T13:00:00Z" });

      expect((await store.getAnalysis(a.id))?.status).toBe("failed");
      expect(await store.listRecent(10)).toHaveLength(1);
    });

    it("finds an analysis by its key", async () => {
      await store.saveAnalysis(a);
      await store.saveAnalysis(b);

      expect((await store.findByKey(b.key))?.id).toBe(b.id);
      expect(await store.findByKey({ ...a.key, pipelineVersion: "other" })).toBeNull();
      expect(
        await store.findByKey({ ...a.key, ref: { ...a.key.ref, number: a.key.ref.number + 1 } }),
      ).toBeNull();
    });

    it("lists recent analyses, most recently updated first, up to the limit", async () => {
      await store.saveAnalysis(a);
      await store.saveAnalysis(b);
      await store.saveAnalysis(c);

      expect((await store.listRecent(10)).map((analysis) => analysis.id)).toEqual([
        b.id,
        c.id,
        a.id,
      ]);
      expect((await store.listRecent(2)).map((analysis) => analysis.id)).toEqual([b.id, c.id]);
    });

    it("lists analyzed PRs once each, most recently analyzed first, up to the limit", async () => {
      const ref = smallFeatureAnalysis.key.ref;
      const other = { ...ref, number: ref.number + 1 };
      const otherKey: AnalysisKey = { ...a.key, ref: other };
      const onOther: Analysis = {
        ...a,
        id: analysisId(otherKey),
        key: otherKey,
        updatedAt: "2026-10-21T11:30:00Z",
      };
      await store.saveAnalysis(a);
      await store.saveAnalysis(b);
      await store.saveAnalysis(c);
      await store.saveAnalysis(onOther);

      // ref's latest analysis, b at 12:00, is newer than other's at 11:30.
      expect(await store.listAnalyzedPullRequests(10)).toEqual([ref, other]);
      expect(await store.listAnalyzedPullRequests(1)).toEqual([ref]);
    });

    it("clears an analysis's point reviews, leaving other analyses' alone", async () => {
      await store.saveAnalysis(a);
      await store.saveAnalysis(b);
      await store.savePointReview(a.id, review("f1", "dismissed"));
      await store.savePointReview(b.id, review("f1", "raised"));

      await store.clearPointReviews(a.id);

      expect(await store.getPointReviews(a.id)).toEqual([]);
      expect(await store.getPointReviews(b.id)).toEqual([review("f1", "raised")]);
    });

    it("upserts point reviews by point", async () => {
      await store.saveAnalysis(a);
      await store.savePointReview(a.id, review("f1", "dismissed"));
      await store.savePointReview(a.id, review("r:h_0123456789abcdef", "raised"));
      await store.savePointReview(a.id, review("f1", "raised"));

      const reviews = await store.getPointReviews(a.id);
      expect([...reviews].sort((x, y) => (x.pointId < y.pointId ? -1 : 1))).toEqual([
        review("f1", "raised"),
        review("r:h_0123456789abcdef", "raised"),
      ]);
    });

    it("records posted comments", async () => {
      await store.saveAnalysis(a);
      await store.recordPostedComment(a.id, summaryKey, "101");
      await store.recordPostedComment(a.id, d3Key, "102");

      expect(Object.fromEntries(await store.getPostedComments(a.id))).toEqual({
        summary: "101",
        "decision:d3": "102",
      });
    });

    it("records a publication", async () => {
      await store.saveAnalysis(a);
      await store.recordPublication(a.id, receipt);
      expect(await store.getPublication(a.id)).toEqual(receipt);
    });

    it("keeps each analysis's data apart", async () => {
      await store.saveAnalysis(a);
      await store.saveAnalysis(b);
      await store.savePointReview(a.id, review("d1", "raised"));
      await store.recordPostedComment(a.id, summaryKey, "101");
      await store.recordPublication(a.id, receipt);

      expect(await store.getPointReviews(b.id)).toEqual([]);
      expect([...(await store.getPostedComments(b.id))]).toEqual([]);
      expect(await store.getPublication(b.id)).toBeNull();
    });

    it("keeps its own copies of what it stores and returns", async () => {
      const warnings: string[] = [];
      await store.saveAnalysis({ ...a, warnings });
      warnings.push("changed after saving");

      const first = await store.getAnalysis(a.id);
      if (first !== null) Reflect.set(first, "status", "failed");

      expect(await store.getAnalysis(a.id)).toEqual(a);
    });
  });
};
