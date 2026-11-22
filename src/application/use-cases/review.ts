import {
  type Analysis,
  type AnalysisId,
  buildPublication,
  commentFits,
  type HunkComment,
  isEmptyPublication,
  type PointId,
  type PointReview,
  type PointState,
  type Publication,
  type PublicationId,
  type PublicationReceipt,
  type PublicationVerdict,
  pointSignalKey,
  pointsOf,
  publishedSignalKey,
} from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import type { GitHost } from "../ports/index.ts";
import type { AppDeps } from "./deps.ts";
import { appError, fromHostError, type UseCaseError } from "./errors.ts";
import { hostFor } from "./hosts.ts";
import { recordSignal, removeSignal } from "./signals.ts";

const MAX_CACHED_BYTES = 1024 * 1024;

/** Checking costs an API call and the UI refetches the view on every event. */
const STALE_CHECK_TTL_MS = 60_000;

export interface AnalysisView {
  readonly analysis: Analysis;
  readonly pointReviews: readonly PointReview[];
  /** The latest review published from it. */
  readonly publication: PublicationReceipt | null;
  /** The current user opened the PR, so the review can only comment, not approve. */
  readonly isAuthor: boolean;
  /** The current user's ID on the host, as its reviewers are named; null when unknown. */
  readonly currentUserId: string | null;
  /** The PR has new commits since this complete analysis. */
  readonly stale: boolean;
}

const currentUserIdOf = async (host: GitHost | undefined): Promise<string | null> => {
  if (host === undefined) return null;
  const user = await host.currentUser();
  return user.ok ? user.value.id : null;
};

/** False when unsure: the host decides anyway, and a wrong "true" would hide the verdict. */
const isAuthorOf = (currentUserId: string | null, analysis: Analysis): boolean =>
  currentUserId !== null && currentUserId === analysis.pullRequest?.author.id;

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

/** One review to publish, with the ID the page chose for it, the same on every retry. */
export interface PublishInput extends ReviewInput {
  readonly publicationId: PublicationId;
  readonly summary: string;
  /** Publish even though the PR has new commits since the analysis. */
  readonly allowStale: boolean;
}

/** Reading the analysis, recording point states, and publishing the review. */
export const createReviewUseCases = (deps: AppDeps) => {
  const staleChecks = new Map<AnalysisId, { checkedAt: number; stale: boolean }>();
  /** The publish running on each analysis: one at a time, so the numbers can't collide. */
  const publishing = new Map<
    AnalysisId,
    {
      readonly publicationId: PublicationId;
      readonly attempt: Promise<Result<PublicationReceipt, UseCaseError>>;
    }
  >();

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
        isAuthor: isAuthorOf(
          await currentUserIdOf(deps.hosts[analysis.key.ref.repo.host]),
          analysis,
        ),
        hunkComments: review.hunkComments,
        verdict: review.verdict,
      }),
    );
  };

  const publish = async (
    analysis: Analysis,
    input: PublishInput,
  ): Promise<Result<PublicationReceipt, UseCaseError>> => {
    const { id, key } = analysis;
    // An analysis publishes as many reviews as the reviewer sends, one for each ID; a request
    // repeating one that's published, after its answer was lost, gets its receipt.
    const publications = await deps.store.getPublications(id);
    const repeated = publications.find((stored) => stored.id === input.publicationId);
    if (repeated !== undefined) return ok(repeated.receipt);
    // The one after the last that finished, which a failed attempt may have started.
    const number = (publications.at(-1)?.number ?? 0) + 1;

    const host = hostFor(deps, key.ref.repo.host);
    if (!host.ok) return host;
    const current = await host.value.getPullRequest(key.ref);
    if (!current.ok) return err(fromHostError(current.error));
    if (current.value.headSha !== key.headSha && !input.allowStale) {
      return err(
        appError("stale-analysis", "The pull request has new commits since this analysis"),
      );
    }

    const built = await publicationFor(analysis, input.summary, input);
    if (!built.ok) return built;
    const publication = built.value;
    if (isEmptyPublication(publication)) {
      return err(
        appError("bad-request", "Nothing to publish: no comment, no summary and no verdict"),
      );
    }
    const alreadyPosted = await deps.store.getPostedComments(id, number);
    const published = await host.value.publish(key.ref, publication, {
      headSha: key.headSha,
      alreadyPosted: new Set(alreadyPosted.keys()),
      onPosted: async (commentKey, hostCommentId) => {
        await deps.store.recordPostedComment(id, number, commentKey, hostCommentId);
        // A line comment says what the reviewer looks for. Keyed by the review and the comment,
        // so a retry that posts the rest writes each once.
        const comment = publication.comments.find((one) => one.key === commentKey);
        if (comment === undefined) return;
        await recordSignal(deps, publishedSignalKey(id, number, commentKey), {
          kind: "comment",
          at: deps.clock.now(),
          pullRequest: key.ref,
          pointKind: null,
          title: "",
          text: comment.body,
          path: comment.path,
        });
      },
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
    await deps.store.recordPublication(id, { number, id: input.publicationId, receipt });
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
      const [pointReviews, publications, currentUserId, stale] = await Promise.all([
        deps.store.getPointReviews(id),
        deps.store.getPublications(id),
        currentUserIdOf(host),
        isStale(analysis.value),
      ]);
      const publication = publications.at(-1)?.receipt ?? null;
      return ok({
        analysis: analysis.value,
        pointReviews,
        publication,
        isAuthor: isAuthorOf(currentUserId, analysis.value),
        currentUserId,
        stale,
      });
    },

    async recordPointState(
      id: AnalysisId,
      pointId: PointId,
      state: PointState,
    ): Promise<Result<PointReview, UseCaseError>> {
      const analysis = await getComplete(id);
      if (!analysis.ok) return analysis;
      const point = pointsOf(analysis.value).find((one) => one.id === pointId);
      if (point === undefined) {
        return err(appError("not-found", `No point ${pointId} in analysis ${id}`));
      }
      const saved: PointReview = { pointId, state, updatedAt: deps.clock.now() };
      await deps.store.savePointReview(id, saved);
      // The point's text as it is now: Remove AI review takes it away, and a new run reuses its ID.
      const signalKey = pointSignalKey(id, pointId);
      if (state === "open") await removeSignal(deps, signalKey);
      else {
        await recordSignal(deps, signalKey, {
          kind: state,
          at: saved.updatedAt,
          pullRequest: analysis.value.key.ref,
          pointKind: point.kind,
          title: point.title,
          text: point.explanation,
          path: point.path,
        });
      }
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
      input: PublishInput,
    ): Promise<Result<PublicationReceipt, UseCaseError>> {
      const analysis = await getComplete(id);
      if (!analysis.ok) return analysis;
      // A second click joins the first; another review waits for it, then takes the next number.
      const running = publishing.get(id);
      if (running?.publicationId === input.publicationId) return running.attempt;
      const attempt: Promise<Result<PublicationReceipt, UseCaseError>> = (
        running?.attempt ?? Promise.resolve()
      )
        .then(() => publish(analysis.value, input))
        .finally(() => {
          if (publishing.get(id)?.attempt === attempt) publishing.delete(id);
        });
      publishing.set(id, { publicationId: input.publicationId, attempt });
      return attempt;
    },

    /**
     * Takes back the reviewer's approval on the host, however it was given. Not retried: a write
     * that failed on the network may have landed, and the reviewer can send it again harmlessly.
     */
    async revokeApproval(id: AnalysisId): Promise<Result<null, UseCaseError>> {
      const analysis = await getAnalysis(id);
      if (!analysis.ok) return analysis;
      const { ref } = analysis.value.key;
      const host = hostFor(deps, ref.repo.host);
      if (!host.ok) return host;
      const revoked = await host.value.revokeApproval(ref);
      return revoked.ok ? revoked : err(fromHostError(revoked.error));
    },
  };
};
