import type {
  Analysis,
  AnalysisId,
  AnalysisKey,
  CommentKey,
  PointReview,
  PublicationReceipt,
  PullRequestRef,
} from "../../domain/review/index.ts";

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
  getPostedComments(id: AnalysisId): Promise<ReadonlyMap<CommentKey, string>>;
  recordPostedComment(id: AnalysisId, key: CommentKey, hostCommentId: string): Promise<void>;
  getPublication(id: AnalysisId): Promise<PublicationReceipt | null>;
  recordPublication(id: AnalysisId, receipt: PublicationReceipt): Promise<void>;
}
