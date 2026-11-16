import type {
  Analysis,
  AnalysisId,
  AnalysisKey,
  CommentKey,
  PointReview,
  PublicationId,
  PublicationReceipt,
  PullRequestRef,
  ReviewActivity,
  Timestamp,
} from "../../domain/review/index.ts";

/** A post the reviewer made on a PR's conversation at once, outside a review. */
export type ThreadPostKind = "reply" | "comment";

/**
 * A review published from an analysis: its number among the analysis's publications, from 1, and
 * the ID the page chose for it, none before pages chose one.
 */
export interface StoredPublication {
  readonly number: number;
  readonly id: PublicationId | null;
  readonly receipt: PublicationReceipt;
}

export interface AnalysisStore {
  getAnalysis(id: AnalysisId): Promise<Analysis | null>;
  findByKey(key: AnalysisKey): Promise<Analysis | null>;
  /** Upsert by id. */
  saveAnalysis(analysis: Analysis): Promise<void>;
  /** Most recently updated first. */
  listRecent(limit: number): Promise<Analysis[]>;
  /** The PRs that have an analysis, each once, the most recently analyzed first. */
  listAnalyzedPullRequests(limit: number): Promise<PullRequestRef[]>;
  getPointReviews(id: AnalysisId): Promise<PointReview[]>;
  /** Upsert by pointId. */
  savePointReview(id: AnalysisId, review: PointReview): Promise<void>;
  clearPointReviews(id: AnalysisId): Promise<void>;
  /**
   * The analysis's publications, by number. One is recorded once all of it is posted, so the
   * number after the last is the one being published.
   */
  getPublications(id: AnalysisId): Promise<StoredPublication[]>;
  /** What publication `number` has posted so far, by key, so a retry posts only the rest. */
  getPostedComments(id: AnalysisId, number: number): Promise<ReadonlyMap<CommentKey, string>>;
  recordPostedComment(
    id: AnalysisId,
    number: number,
    key: CommentKey,
    hostCommentId: string,
  ): Promise<void>;
  recordPublication(id: AnalysisId, publication: StoredPublication): Promise<void>;
  /** Records, at the store's clock, a reply or a comment the host accepted. */
  recordThreadPost(id: AnalysisId, kind: ThreadPostKind): Promise<void>;
  /**
   * The reviews published and the comments posted at or after `since`: a review's comments but
   * its summary, and every thread post.
   */
  getReviewActivity(since: Timestamp): Promise<ReviewActivity>;
}
