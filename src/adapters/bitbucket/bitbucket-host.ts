import type { Clock, GitHost, Logger } from "../../application/ports/index.ts";
import {
  type CommentKey,
  type HostError,
  type HostUser,
  type PullRequestRef,
  type PullRequestSummary,
  pullRequestUrl,
  type RepoRef,
} from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import { API, type BitbucketClient, createBitbucketClient } from "./client.ts";
import { byUpdatedAtDesc, toHostUser, toPullRequest, toSummary } from "./map.ts";
import {
  type CommentRequest,
  generalComment,
  inlineComment,
  SUMMARY,
  VERDICT_ENDPOINTS,
} from "./publish.ts";
import {
  BitbucketAccount,
  BitbucketComment,
  BitbucketCommit,
  BitbucketCommitHash,
  BitbucketPage,
  BitbucketParticipant,
  BitbucketPullRequest,
  BitbucketRepository,
} from "./schemas.ts";

export interface BitbucketHostOptions {
  /** Basic auth: an Atlassian email and API token, or a Bitbucket username and app password. */
  readonly username: string;
  readonly password: string;
  /** Where listPullRequests looks. null means it lists nothing. */
  readonly workspace: string | null;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly fetch?: typeof fetch;
  /** How long a call may take before it fails as a network error. */
  readonly requestTimeoutMs?: number;
}

/** Repositories scanned for PRs to review: Bitbucket has no cross-repo reviewer search. */
const SCANNED_REPOS = 50;
const SCAN_CONCURRENCY = 5;
const FILE_CONCURRENCY = 8;
const PAGE_SIZE = 50;

/** Merge-base failures that a fallback can't fix, because every other call fails the same way. */
const FATAL: ReadonlySet<HostError["kind"]> = new Set([
  "unauthorized",
  "forbidden",
  "rate-limited",
  "network",
]);

const segment = encodeURIComponent;
const repoUrl = ({ owner, repo }: RepoRef): string =>
  `${API}/repositories/${segment(owner)}/${segment(repo)}`;
const pullRequestApiUrl = (ref: PullRequestRef): string =>
  `${repoUrl(ref.repo)}/pullrequests/${ref.number}`;
const withQuery = (url: string, query: Record<string, string>): string =>
  `${url}?${new URLSearchParams(query)}`;

/** Runs `task` over `items`, at most `limit` at a time, keeping the order. */
const mapLimit = async <T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = [];
  // One iterator shared by the workers, so each item is taken once.
  const queue = items.entries();
  const worker = async (): Promise<void> => {
    for (const [index, item] of queue) results[index] = await task(item);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};

export const createBitbucketHost = (options: BitbucketHostOptions): GitHost => {
  const { clock, logger, workspace } = options;
  const client: BitbucketClient = createBitbucketClient({
    username: options.username,
    password: options.password,
    logger,
    fetch: options.fetch ?? globalThis.fetch,
    requestTimeoutMs: options.requestTimeoutMs,
  });

  let cachedUser: HostUser | null = null;

  const currentUser = async (): Promise<Result<HostUser, HostError>> => {
    if (cachedUser !== null) return ok(cachedUser);
    const user = await client.json("the current user", BitbucketAccount, `${API}/user`);
    if (!user.ok) return user;
    cachedUser = toHostUser(user.value);
    return ok(cachedUser);
  };

  /**
   * The merge base the diff is computed from, else the destination commit: formatting proofs
   * then compare against a newer base, which can only cost proofs, never fake them.
   */
  const baseSha = async (
    repo: RepoRef,
    head: string,
    destination: string,
  ): Promise<Result<string, HostError>> => {
    const mergeBase = await client.json(
      "the merge base",
      BitbucketCommitHash,
      `${repoUrl(repo)}/merge-base/${head}..${destination}`,
    );
    if (mergeBase.ok) return ok(mergeBase.value.hash);
    if (FATAL.has(mergeBase.error.kind)) return mergeBase;
    logger.warn("Couldn't get the merge base from Bitbucket; using the destination commit", {
      error: mergeBase.error.message,
    });
    const fallback = await client.json(
      "the destination commit",
      BitbucketCommitHash,
      `${repoUrl(repo)}/commit/${destination}`,
    );
    return fallback.ok ? ok(fallback.value.hash) : fallback;
  };

  /** PRs to review in the most recently updated repositories of the workspace. */
  const reviewing = async (
    scanned: string,
    user: HostUser,
  ): Promise<Result<PullRequestSummary[], HostError>> => {
    const repos = await client.json(
      "the workspace's repositories",
      BitbucketPage(BitbucketRepository),
      withQuery(`${API}/repositories/${segment(scanned)}`, {
        role: "member",
        sort: "-updated_on",
        pagelen: String(SCANNED_REPOS),
      }),
    );
    if (!repos.ok) return repos;
    // Said only when it leaves something out: with every repository scanned, the list is whole.
    if (repos.value.next !== undefined) {
      logger.info(
        "Bitbucket can't search for PRs to review across repositories; scanned only the most recently updated ones, so PRs in the others aren't listed",
        { workspace: scanned, scanned: repos.value.values.length },
      );
    }

    // `state` is ignored once `q` is set, so it goes in the query. An OR with `author.uuid`
    // returns each PR once per reviewer, which is why authored PRs come from elsewhere.
    const q = `state="OPEN" AND reviewers.uuid="${user.id}"`;
    const perRepo = await mapLimit(repos.value.values, SCAN_CONCURRENCY, ({ slug }) =>
      client.pages(
        "the pull requests to review",
        BitbucketPullRequest,
        withQuery(`${repoUrl({ host: "bitbucket", owner: scanned, repo: slug })}/pullrequests`, {
          q,
          sort: "-updated_on",
          pagelen: String(PAGE_SIZE),
        }),
      ),
    );
    const summaries: PullRequestSummary[] = [];
    for (const result of perRepo) {
      if (!result.ok) return result;
      summaries.push(...result.value.map((pullRequest) => toSummary(pullRequest, "reviewer")));
    }
    return ok(summaries);
  };

  /** Open PRs the user authored, in every repository of the workspace. */
  const authored = async (
    scanned: string,
    user: HostUser,
  ): Promise<Result<PullRequestSummary[], HostError>> => {
    const result = await client.pages(
      "the pull requests you authored",
      BitbucketPullRequest,
      withQuery(`${API}/workspaces/${segment(scanned)}/pullrequests/${segment(user.id)}`, {
        state: "OPEN",
        pagelen: String(PAGE_SIZE),
      }),
    );
    return result.ok ? ok(result.value.map((pr) => toSummary(pr, "author"))) : result;
  };

  return {
    host: "bitbucket",

    currentUser,

    async getPullRequest(ref) {
      const pullRequest = await client.json(
        "the pull request",
        BitbucketPullRequest,
        pullRequestApiUrl(ref),
      );
      if (!pullRequest.ok) return pullRequest;
      const head = pullRequest.value.source.commit?.hash;
      const destination = pullRequest.value.destination.commit?.hash;
      if (head === undefined || destination === undefined) {
        return err({
          kind: "not-found",
          message:
            "Bitbucket has no source commit for this pull request: its branch or fork was deleted.",
          retryAfterSeconds: null,
        });
      }

      // The diff is pinned to the PR's commits, so it can't be from a newer push than headSha.
      // It's the three-dot diff the PR's own diff endpoint redirects to. Fork commits resolve
      // in the destination repository too.
      const [diff, headSha, base, commits] = await Promise.all([
        client.text(
          withQuery(`${repoUrl(ref.repo)}/diff/${head}..${destination}`, { topic: "true" }),
          "text/plain",
        ),
        client.json("the head commit", BitbucketCommitHash, `${repoUrl(ref.repo)}/commit/${head}`),
        baseSha(ref.repo, head, destination),
        client.pages(
          "the commits",
          BitbucketCommit,
          withQuery(`${pullRequestApiUrl(ref)}/commits`, { pagelen: "100" }),
        ),
      ]);
      if (!diff.ok) return diff;
      if (!headSha.ok) return headSha;
      if (!base.ok) return base;
      if (!commits.ok) return commits;

      return ok(
        toPullRequest(ref, pullRequest.value, {
          baseSha: base.value,
          headSha: headSha.value.hash,
          commits: commits.value,
          diff: diff.value,
        }),
      );
    },

    async getFiles(repo, files) {
      // Bitbucket has no batch read, so files come one request each, a few at a time.
      const contents = await mapLimit(files, FILE_CONCURRENCY, async ({ sha, path }) => {
        const encodedPath = path.split("/").map(segment).join("/");
        const content = await client.text(`${repoUrl(repo)}/src/${sha}/${encodedPath}`, "*/*");
        if (
          !content.ok &&
          (content.error.kind === "not-found" || content.error.kind === "too-large")
        ) {
          return ok(null);
        }
        return content;
      });
      const found: (string | null)[] = [];
      for (const content of contents) {
        if (!content.ok) return content;
        found.push(content.value);
      }
      return ok(found);
    },

    async listPullRequests() {
      if (workspace === null) return ok([]);
      const user = await currentUser();
      if (!user.ok) return user;
      const [toReview, own] = await Promise.all([
        reviewing(workspace, user.value),
        authored(workspace, user.value),
      ]);
      if (!toReview.ok) return toReview;
      if (!own.ok) return own;
      return ok([...toReview.value, ...own.value].sort(byUpdatedAtDesc));
    },

    async publish(ref, publication, { headSha, alreadyPosted, onPosted }) {
      // Bitbucket anchors inline comments on the PR's current diff, not on a commit, so lines
      // from an older head would land in the wrong place.
      const current = await client.json(
        "the pull request",
        BitbucketPullRequest,
        pullRequestApiUrl(ref),
      );
      if (!current.ok) return current;
      const currentHead = current.value.source.commit?.hash;
      if (currentHead === undefined || !headSha.startsWith(currentHead)) {
        return err({
          kind: "rejected",
          message:
            "The pull request has new commits since it was analyzed. Reopen it to review the new ones.",
          retryAfterSeconds: null,
        });
      }

      const commentsUrl = `${pullRequestApiUrl(ref)}/comments`;
      const posted: [CommentKey, string][] = [];
      const post = async (
        key: CommentKey,
        body: CommentRequest,
      ): Promise<Result<null, HostError>> => {
        const comment = await client.json("the new comment", BitbucketComment, commentsUrl, {
          method: "POST",
          body,
          call: "publish",
        });
        if (!comment.ok) return comment;
        const id = String(comment.value.id);
        posted.push([key, id]);
        await onPosted(key, id);
        return ok(null);
      };

      // One call per comment, each recorded as soon as it's posted, so a retry after a
      // failure posts only the rest.
      for (const comment of publication.comments) {
        if (alreadyPosted.has(comment.key)) continue;
        const result = await post(comment.key, inlineComment(comment));
        if (!result.ok) return result;
      }
      // Bitbucket rejects an empty comment, and an empty summary has nothing to say.
      if (!alreadyPosted.has(SUMMARY) && publication.summary.trim() !== "") {
        const result = await post(SUMMARY, generalComment(publication.summary));
        if (!result.ok) return result;
      }
      const verdict = VERDICT_ENDPOINTS[publication.verdict];
      if (verdict !== null) {
        const result = await client.json(
          "the verdict",
          BitbucketParticipant,
          `${pullRequestApiUrl(ref)}/${verdict}`,
          { method: "POST", call: "publish" },
        );
        if (!result.ok) return result;
      }

      return ok({
        url: pullRequestUrl(ref),
        publishedAt: clock.now(),
        postedCommentIds: Object.fromEntries(posted),
      });
    },
  };
};
