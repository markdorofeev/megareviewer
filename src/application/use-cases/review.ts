import {
  type Analysis,
  type AnalysisId,
  buildPublication,
  commentFits,
  type HunkComment,
  type PointId,
  type PointReview,
  type PointState,
  type Publication,
  type PublicationReceipt,
  type PublicationVerdict,
  pointsOf,
} from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import type { GitHost } from "../ports/index.ts";
import { hostFor } from "./analyses.ts";
import type { AppDeps } from "./deps.ts";
import { appError, fromHostError, type UseCaseError } from "./errors.ts";

const MAX_CACHED_BYTES = 1024 * 1024;

/** Checking costs an API call and the UI refetches the view on every event. */
const STALE_CHECK_TTL_MS = 60_000;

export interface AnalysisView {
  readonly analysis: Analysis;
  readonly pointReviews: readonly PointReview[];
  readonly publication: PublicationReceipt | null;
  /** The current user opened the PR, so the review can only comment, not approve. */
  readonly isAuthor: boolean;
  /** The PR has new commits since this complete analysis. */
  readonly stale: boolean;
}

/** False when unsure: the host decides anyway, and a wrong "true" would hide the verdict. */
const isAuthorOf = async (host: GitHost | undefined, analysis: Analysis): Promise<boolean> => {
  if (host === undefined || analysis.pullRequest === null) return false;
  const user = await host.currentUser();
  return user.ok && user.value.id === analysis.pullRequest.author.id;
};

/** A file at a commit: null when it isn't there. */
export interface FileContent {
  readonly content: string | null;
}

/** What the reviewer publishes: their comments, raised points among them, and their verdict. */
export interface ReviewInput {
  readonly hunkComments: readonly HunkComment[];
  /** The reviewer's verdict, or null for a comment. */
  readonly verdict: PublicationVerdict | null;
}

const NO_REVIEW_INPUT: ReviewInput = { hunkComments: [], verdict: null };

/** Reading the analysis, recording point states, and publishing the review. */
export const createReviewUseCases = (deps: AppDeps) => {
  const staleChecks = new Map<AnalysisId, { checkedAt: number; stale: boolean }>();
  /** One publish per analysis at a time, so a double click can't post twice. */
  const publishing = new Map<AnalysisId, Promise<Result<PublicationReceipt, UseCaseError>>>();

  const getAnalysis = async (id: AnalysisId): Promise<Result<Analysis, UseCaseError>> => {
    const analysis = await deps.store.getAnalysis(id);
    return analysis === null ? err(appError("not-found", `No analysis ${id}`)) : ok(analysis);
  };

  const getComplete = async (id: AnalysisId): Promise<Result<Analysis, UseCaseError>> => {
    const analysis = await getAnalysis(id);
    if (analysis.ok && analysis.value.status !== "complete") {
      return err(appError("analysis-not-complete", "The analysis isn't complete"));
    }
    return analysis;
  };

  const isStale = async (analysis: Analysis): Promise<boolean> => {
    const host = deps.hosts[analysis.key.ref.repo.host];
    if (analysis.status !== "complete" || host === undefined) return false;
    const now = Date.parse(deps.clock.now());
    const cached = staleChecks.get(analysis.id);
    if (cached !== undefined && now - cached.checkedAt < STALE_CHECK_TTL_MS) return cached.stale;
    const current = await host.getPullRequest(analysis.key.ref);
    // Unknown counts as fresh: publishing checks again and refuses a stale analysis.
    if (!current.ok) return false;
    const stale = current.value.headSha !== analysis.key.headSha;
    staleChecks.set(analysis.id, { checkedAt: now, stale });
    return stale;
  };

  const publicationFor = async (
    analysis: Analysis,
    summary: string,
    review: ReviewInput,
  ): Promise<Result<Publication, UseCaseError>> => {
    const hunks = new Map(
      analysis.files.flatMap((file) => file.hunks.map((hunk) => [hunk.id, hunk] as const)),
    );
    const misplaced = review.hunkComments.find((comment) => !commentFits(hunks, comment));
    if (misplaced !== undefined) {
      return err(
        appError(
          "bad-request",
          `A comment is on ${misplaced.side} line ${misplaced.line} of hunk ${misplaced.hunkId}, which the diff doesn't show`,
        ),
      );
    }
    return ok(
      buildPublication({
        analysis,
        summary,
        isAuthor: await isAuthorOf(deps.hosts[analysis.key.ref.repo.host], analysis),
        hunkComments: review.hunkComments,
        verdict: review.verdict,
      }),
    );
  };

  const publish = async (
    analysis: Analysis,
    summary: string,
    allowStale: boolean,
    review: ReviewInput,
  ): Promise<Result<PublicationReceipt, UseCaseError>> => {
    const { id, key } = analysis;
    // One publication per analysis.
    const existing = await deps.store.getPublication(id);
    if (existing !== null) return ok(existing);

    const host = hostFor(deps, key.ref.repo.host);
    if (!host.ok) return host;
    const current = await host.value.getPullRequest(key.ref);
    if (!current.ok) return err(fromHostError(current.error));
    if (current.value.headSha !== key.headSha && !allowStale) {
      return err(
        appError("stale-analysis", "The pull request has new commits since this analysis"),
      );
    }

    const built = await publicationFor(analysis, summary, review);
    if (!built.ok) return built;
    const publication = built.value;
    const alreadyPosted = await deps.store.getPostedComments(id);
    const published = await host.value.publish(key.ref, publication, {
      headSha: key.headSha,
      alreadyPosted: new Set(alreadyPosted.keys()),
      onPosted: (commentKey, hostCommentId) =>
        deps.store.recordPostedComment(id, commentKey, hostCommentId),
    });
    // Posted comments are already recorded, so a retry continues where this stopped.
    if (!published.ok) return err(appError("host-error", published.error.message));
    const receipt: PublicationReceipt = {
      ...published.value,
      // Include what an earlier, partly failed attempt posted: the receipt covers the review.
      postedCommentIds: {
        ...Object.fromEntries(alreadyPosted),
        ...published.value.postedCommentIds,
      },
    };
    await deps.store.recordPublication(id, receipt);
    return ok(receipt);
  };

  return {
    /**
     * A changed file's content at the PR's head commit, or at its base for "base", so the page can
     * open the unchanged lines between and around its changes. Only the PR's own files: the route
     * reads the repository through the reviewer's credentials, and nothing else needs it.
     */
    async getFileContent(
      id: AnalysisId,
      side: "base" | "head",
      path: string,
    ): Promise<Result<FileContent, UseCaseError>> {
      const analysis = await getAnalysis(id);
      if (!analysis.ok) return analysis;
      const { pullRequest, files, key } = analysis.value;
      const file = files.find((one) =>
        side === "head"
          ? one.status !== "deleted" && one.path === path
          : one.status !== "added" && (one.oldPath ?? one.path) === path,
      );
      if (pullRequest === null || file === undefined || file.binary) {
        return err(appError("not-found", `No changed ${side} file ${path} in analysis ${id}`));
      }
      const { repo } = key.ref;
      const at = { sha: side === "head" ? pullRequest.headSha : pullRequest.baseSha, path };
      const cached = await deps.fileCache.get(repo, at);
      if (cached !== null) return ok({ content: cached.content });
      const host = hostFor(deps, repo.host);
      if (!host.ok) return host;
      const fetched = await host.value.getFiles(repo, [at]);
      if (!fetched.ok) return err(fromHostError(fetched.error));
      const content = fetched.value[0] ?? null;
      // As Collect does, a file over 1 MB isn't kept.
      if (content === null || new TextEncoder().encode(content).byteLength <= MAX_CACHED_BYTES) {
        await deps.fileCache.put(repo, at, content);
      }
      return ok({ content });
    },

    async getAnalysisView(id: AnalysisId): Promise<Result<AnalysisView, UseCaseError>> {
      const analysis = await getAnalysis(id);
      if (!analysis.ok) return analysis;
      const host = deps.hosts[analysis.value.key.ref.repo.host];
      const [pointReviews, publication, isAuthor, stale] = await Promise.all([
        deps.store.getPointReviews(id),
        deps.store.getPublication(id),
        isAuthorOf(host, analysis.value),
        isStale(analysis.value),
      ]);
      return ok({ analysis: analysis.value, pointReviews, publication, isAuthor, stale });
    },

    async recordPointState(
      id: AnalysisId,
      pointId: PointId,
      state: PointState,
    ): Promise<Result<PointReview, UseCaseError>> {
      const analysis = await getComplete(id);
      if (!analysis.ok) return analysis;
      if (!pointsOf(analysis.value).some((point) => point.id === pointId)) {
        return err(appError("not-found", `No point ${pointId} in analysis ${id}`));
      }
      const saved: PointReview = { pointId, state, updatedAt: deps.clock.now() };
      await deps.store.savePointReview(id, saved);
      return ok(saved);
    },

    /** Exactly what publishReview would send. */
    async previewPublication(
      id: AnalysisId,
      summary: string,
      review: ReviewInput = NO_REVIEW_INPUT,
    ): Promise<Result<Publication, UseCaseError>> {
      const analysis = await getComplete(id);
      return analysis.ok ? publicationFor(analysis.value, summary, review) : analysis;
    },

    async publishReview(
      id: AnalysisId,
      summary: string,
      allowStale: boolean,
      review: ReviewInput = NO_REVIEW_INPUT,
    ): Promise<Result<PublicationReceipt, UseCaseError>> {
      const analysis = await getComplete(id);
      if (!analysis.ok) return analysis;
      const running = publishing.get(id);
      if (running !== undefined) return running;
      const attempt = publish(analysis.value, summary, allowStale, review).finally(() =>
        publishing.delete(id),
      );
      publishing.set(id, attempt);
      return attempt;
    },
  };
};
