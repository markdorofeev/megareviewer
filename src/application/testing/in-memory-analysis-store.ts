import type {
  Analysis,
  AnalysisId,
  AnalysisKey,
  CommentKey,
  PointId,
  PointReview,
  PublicationReceipt,
  PullRequestRef,
} from "../../domain/review/index.ts";
import type { AnalysisStore } from "../ports/index.ts";

const sameKey = (a: AnalysisKey, b: AnalysisKey): boolean =>
  a.ref.repo.host === b.ref.repo.host &&
  a.ref.repo.owner === b.ref.repo.owner &&
  a.ref.repo.repo === b.ref.repo.repo &&
  a.ref.number === b.ref.number &&
  a.headSha === b.headSha &&
  a.pipelineVersion === b.pipelineVersion;

/** Copies on every read and write, so a test that mutates stored data fails loudly. */
export class InMemoryAnalysisStore implements AnalysisStore {
  private readonly analyses = new Map<AnalysisId, Analysis>();
  private readonly pointReviews = new Map<AnalysisId, Map<PointId, PointReview>>();
  private readonly postedComments = new Map<AnalysisId, Map<CommentKey, string>>();
  private readonly publications = new Map<AnalysisId, PublicationReceipt>();

  async getAnalysis(id: AnalysisId): Promise<Analysis | null> {
    return structuredClone(this.analyses.get(id) ?? null);
  }

  async findByKey(key: AnalysisKey): Promise<Analysis | null> {
    const found = [...this.analyses.values()].find((analysis) => sameKey(analysis.key, key));
    return structuredClone(found ?? null);
  }

  async saveAnalysis(analysis: Analysis): Promise<void> {
    this.analyses.set(analysis.id, structuredClone(analysis));
  }

  async listRecent(limit: number): Promise<Analysis[]> {
    return [...this.analyses.values()]
      .sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : a.updatedAt < b.updatedAt ? 1 : 0))
      .slice(0, limit)
      .map((analysis) => structuredClone(analysis));
  }

  async listAnalyzedPullRequests(limit: number): Promise<PullRequestRef[]> {
    const refs = new Map<string, PullRequestRef>();
    for (const analysis of await this.listRecent(this.analyses.size)) {
      const { ref } = analysis.key;
      const key = `${ref.repo.host}/${ref.repo.owner}/${ref.repo.repo}#${ref.number}`;
      if (!refs.has(key)) refs.set(key, ref);
    }
    return [...refs.values()].slice(0, limit);
  }

  async getPointReviews(id: AnalysisId): Promise<PointReview[]> {
    return [...(this.pointReviews.get(id)?.values() ?? [])].map((review) =>
      structuredClone(review),
    );
  }

  async savePointReview(id: AnalysisId, review: PointReview): Promise<void> {
    const reviews = this.pointReviews.get(id) ?? new Map<PointId, PointReview>();
    reviews.set(review.pointId, structuredClone(review));
    this.pointReviews.set(id, reviews);
  }

  async getPostedComments(id: AnalysisId): Promise<ReadonlyMap<CommentKey, string>> {
    return new Map(this.postedComments.get(id));
  }

  async recordPostedComment(id: AnalysisId, key: CommentKey, hostCommentId: string): Promise<void> {
    const posted = this.postedComments.get(id) ?? new Map<CommentKey, string>();
    posted.set(key, hostCommentId);
    this.postedComments.set(id, posted);
  }

  async getPublication(id: AnalysisId): Promise<PublicationReceipt | null> {
    return structuredClone(this.publications.get(id) ?? null);
  }

  async recordPublication(id: AnalysisId, receipt: PublicationReceipt): Promise<void> {
    this.publications.set(id, structuredClone(receipt));
  }
}
