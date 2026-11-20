import type {
  Analysis,
  AnalysisId,
  AnalysisKey,
  CommentKey,
  ModelOptionId,
  PointId,
  PointReview,
  PullRequestRef,
  ReviewActivity,
  Timestamp,
} from "../../domain/review/index.ts";
import type { AnalysisStore, Clock, StoredPublication, ThreadPostKind } from "../ports/index.ts";
import { FixedClock } from "./fixed-clock.ts";

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
  /** By analysis, then publication number. */
  private readonly postedComments = new Map<
    AnalysisId,
    Map<number, Map<CommentKey, { readonly id: string; readonly at: Timestamp }>>
  >();
  private readonly publications = new Map<AnalysisId, StoredPublication[]>();
  private readonly threadPosts: {
    readonly id: AnalysisId;
    readonly kind: ThreadPostKind;
    readonly at: Timestamp;
  }[] = [];

  private lastModelOption: ModelOptionId | null = null;

  private readonly clock: Clock;

  constructor(clock: Clock = new FixedClock()) {
    this.clock = clock;
  }

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

  async clearPointReviews(id: AnalysisId): Promise<void> {
    this.pointReviews.delete(id);
  }

  async getPublications(id: AnalysisId): Promise<StoredPublication[]> {
    return structuredClone(this.publications.get(id) ?? []);
  }

  async getPostedComments(
    id: AnalysisId,
    number: number,
  ): Promise<ReadonlyMap<CommentKey, string>> {
    return new Map(
      [...(this.postedComments.get(id)?.get(number) ?? [])].map(
        ([key, posted]) => [key, posted.id] as const,
      ),
    );
  }

  async recordPostedComment(
    id: AnalysisId,
    number: number,
    key: CommentKey,
    hostCommentId: string,
  ): Promise<void> {
    const byNumber = this.postedComments.get(id) ?? new Map();
    const posted = byNumber.get(number) ?? new Map();
    posted.set(key, { id: hostCommentId, at: this.clock.now() });
    byNumber.set(number, posted);
    this.postedComments.set(id, byNumber);
  }

  async recordPublication(id: AnalysisId, publication: StoredPublication): Promise<void> {
    const others = (this.publications.get(id) ?? []).filter(
      (stored) => stored.number !== publication.number,
    );
    this.publications.set(
      id,
      [...others, structuredClone(publication)].sort((a, b) => a.number - b.number),
    );
  }

  async recordThreadPost(id: AnalysisId, kind: ThreadPostKind): Promise<void> {
    this.threadPosts.push({ id, kind, at: this.clock.now() });
  }

  async getReviewActivity(since: Timestamp): Promise<ReviewActivity> {
    const after = (at: Timestamp) => Date.parse(at) >= Date.parse(since);
    const reviews = [...this.publications].flatMap(([id, publications]) => {
      const analysis = this.analyses.get(id);
      return publications.flatMap(({ receipt }) =>
        analysis === undefined || !after(receipt.publishedAt)
          ? []
          : [{ at: receipt.publishedAt, pullRequest: structuredClone(analysis.key.ref) }],
      );
    });
    const comments = [
      ...[...this.postedComments.values()].flatMap((byNumber) =>
        [...byNumber.values()].flatMap((posted) =>
          [...posted].flatMap(([key, { at }]) => (key === "summary" ? [] : [at])),
        ),
      ),
      ...this.threadPosts.map((post) => post.at),
    ].filter(after);
    return { reviews, comments };
  }

  async getLastModelOption(): Promise<ModelOptionId | null> {
    return this.lastModelOption;
  }

  async recordModelOption(id: ModelOptionId): Promise<void> {
    this.lastModelOption = id;
  }
}
