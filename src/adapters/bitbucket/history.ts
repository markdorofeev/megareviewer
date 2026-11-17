import type { Logger, ReviewHistory } from "../../application/ports/index.ts";
import type { HostError, PastComment, RepoRef } from "../../domain/review/index.ts";
import { ok, type Result } from "../../domain/shared/index.ts";
import { API, createBitbucketClient, MAX_PAGES } from "./client.ts";
import {
  BitbucketAccount,
  BitbucketListedPullRequest,
  BitbucketPage,
  BitbucketThreadComment,
} from "./schemas.ts";
import { toThreads } from "./threads.ts";

export interface BitbucketHistoryOptions {
  readonly username: string;
  readonly password: string;
  readonly logger: Logger;
  readonly fetch?: typeof fetch;
  readonly requestTimeoutMs?: number;
}

/** The most comments a read answers, the newest. */
export const MAX_PAST_COMMENTS = 300;
/** Bitbucket's largest page of pull requests. */
export const LISTED_PER_PAGE = 50;
/** Pull requests whose comments are asked for at once, as their states are. */
const CONCURRENCY = 5;

/** Each pull request's participants and when each last acted, and nothing else of it. */
const LIST_FIELDS =
  "next,values.id,values.updated_on,values.participants.user.uuid,values.participants.participated_on";

const segment = encodeURIComponent;
const repoUrl = ({ owner, repo }: RepoRef): string =>
  `${API}/repositories/${segment(owner)}/${segment(repo)}`;

/**
 * The repository's pull requests the user didn't write, most recently updated first. The state
 * goes in `q`, which makes Bitbucket ignore `state`. Who reviewed can't go in it: `participants`
 * can't be filtered, and `reviewers` leaves out a review by someone who wasn't asked for one.
 */
export const othersPullRequestsUrl = (repo: RepoRef, uuid: string): string =>
  `${repoUrl(repo)}/pullrequests?${new URLSearchParams({
    q: `(state="OPEN" OR state="MERGED" OR state="DECLINED") AND author.uuid!="${uuid}"`,
    sort: "-updated_on",
    pagelen: String(LISTED_PER_PAGE),
    fields: LIST_FIELDS,
  })}`;

export const commentsUrl = (repo: RepoRef, number: number): string =>
  `${repoUrl(repo)}/pullrequests/${number}/comments?pagelen=100`;

/** Whether the user approved, asked for changes or commented on a pull request. */
const reviewedBy = (pullRequest: BitbucketListedPullRequest, uuid: string): boolean =>
  (pullRequest.participants ?? []).some(
    (participant) => participant.user?.uuid === uuid && participant.participated_on != null,
  );

/** What Bitbucket's editor writes after a link it shows as a card, which says nothing. */
const INLINE_CARD = /\{: data-inline-card='[^'\n]*' \}/g;

const newestFirst = (a: PastComment, b: PastComment): number => Date.parse(b.at) - Date.parse(a.at);

export const createBitbucketReviewHistory = (options: BitbucketHistoryOptions): ReviewHistory => {
  const { logger } = options;
  const client = createBitbucketClient({
    username: options.username,
    password: options.password,
    logger,
    fetch: options.fetch ?? globalThis.fetch,
    requestTimeoutMs: options.requestTimeoutMs,
  });

  let uuid: string | null = null;
  const currentUuid = async (): Promise<Result<string, HostError>> => {
    if (uuid !== null) return ok(uuid);
    const user = await client.json("the current user", BitbucketAccount, `${API}/user`);
    if (!user.ok) return user;
    uuid = user.value.uuid;
    return ok(uuid);
  };

  /** The first `wanted` pull requests the user reviewed, among the most recently updated. */
  const reviewed = async (
    repo: RepoRef,
    user: string,
    wanted: number,
  ): Promise<Result<BitbucketListedPullRequest[], HostError>> => {
    const found: BitbucketListedPullRequest[] = [];
    let next: string | undefined = othersPullRequestsUrl(repo, user);
    for (let page = 0; next !== undefined && found.length < wanted; page += 1) {
      if (page === MAX_PAGES) {
        logger.info(
          `Looked for the pull requests you reviewed among the ${MAX_PAGES * LISTED_PER_PAGE} most recently updated; older ones aren't read`,
          { repo: `${repo.owner}/${repo.repo}`, found: found.length },
        );
        break;
      }
      const listed: Result<{ values: BitbucketListedPullRequest[]; next?: string }, HostError> =
        await client.json(
          "the repository's pull requests",
          BitbucketPage(BitbucketListedPullRequest),
          next,
        );
      if (!listed.ok) return listed;
      found.push(...listed.value.values.filter((pullRequest) => reviewedBy(pullRequest, user)));
      next = listed.value.next;
    }
    return ok(found.slice(0, wanted));
  };

  /** The user's comments on the code of one pull request, as its threads read them. */
  const commentsOn = async (
    repo: RepoRef,
    number: number,
    user: string,
  ): Promise<Result<PastComment[], HostError>> => {
    const comments = await client.pages(
      "a pull request's comments",
      BitbucketThreadComment,
      commentsUrl(repo, number),
    );
    if (!comments.ok) return comments;
    return ok(
      toThreads(comments.value).flatMap((thread) =>
        thread.comments
          .filter((comment) => comment.author.id === user)
          .map((comment) => ({
            pullRequest: { repo, number },
            path: thread.path,
            body: comment.body.replace(INLINE_CARD, ""),
            at: comment.createdAt,
          }))
          .filter((comment) => comment.body.trim() !== ""),
      ),
    );
  };

  /**
   * What a read that failed had already got, by pull request and when it was last updated, so
   * its retry asks only for the rest. Dropped once a read succeeds.
   */
  let kept: { readonly repo: string; readonly comments: Map<string, PastComment[]> } | null = null;

  return {
    host: "bitbucket",

    async getReviewerComments(repo, { pullRequests }) {
      const user = await currentUuid();
      if (!user.ok) return user;
      const found = await reviewed(repo, user.value, pullRequests);
      if (!found.ok) return found;

      const repoKey = `${repo.owner}/${repo.repo}`;
      const got = kept?.repo === repoKey ? kept.comments : new Map<string, PastComment[]>();
      kept = { repo: repoKey, comments: got };

      const comments: PastComment[] = [];
      for (let start = 0; start < found.value.length; start += CONCURRENCY) {
        const results = await Promise.all(
          found.value.slice(start, start + CONCURRENCY).map(async ({ id, updated_on }) => {
            const key = `${id}@${updated_on}`;
            const before = got.get(key);
            if (before !== undefined) return ok(before);
            const read = await commentsOn(repo, id, user.value);
            if (read.ok) got.set(key, read.value);
            return read;
          }),
        );
        for (const result of results) {
          if (!result.ok) return result;
          comments.push(...result.value);
        }
      }
      if (kept?.comments === got) kept = null;

      if (comments.length > MAX_PAST_COMMENTS) {
        logger.info(`Kept the ${MAX_PAST_COMMENTS} newest of your comments on Bitbucket`, {
          repo: repoKey,
          found: comments.length,
        });
      }
      return ok({
        comments: comments.sort(newestFirst).slice(0, MAX_PAST_COMMENTS),
        pullRequests: found.value.length,
      });
    },
  };
};
