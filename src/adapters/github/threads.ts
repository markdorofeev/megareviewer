import type { Logger, ReviewThreads } from "../../application/ports/index.ts";
import type {
  HostError,
  HostUser,
  ReviewThread,
  ThreadComment,
} from "../../domain/review/index.ts";
import { ok, type Result } from "../../domain/shared/index.ts";
import { fetchAttachment } from "./attachments.ts";
import { createGitHubClient, type GitHubClientOptions, REQUEST_TIMEOUT_MS } from "./client.ts";
import {
  GitHubReviewCommentPosted,
  type GitHubReviewThread,
  type GitHubThreadComment,
  GitHubThreadPage,
  GitHubThreadReply,
  GitHubThreadResolution,
} from "./schemas.ts";

const COMMENT_FIELDS =
  "id body createdAt author { login ... on User { name } } originalCommit { oid }";

/** A PR's review threads, 100 at a time, with each thread's first 100 comments. */
export const THREADS_QUERY = `query ($owner: String!, $repo: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id isResolved isOutdated path line startLine originalLine diffSide
          viewerCanResolve viewerCanUnresolve viewerCanReply
          resolvedBy { login name }
          comments(first: 100) { nodes { ${COMMENT_FIELDS} } }
        }
      }
    }
  }
}`;

export const REPLY_MUTATION = `mutation ($threadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) {
    comment { ${COMMENT_FIELDS} }
  }
}`;

export const RESOLVE_MUTATION = `mutation ($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) { thread { id } }
}`;

export const UNRESOLVE_MUTATION = `mutation ($threadId: ID!) {
  unresolveReviewThread(input: { threadId: $threadId }) { thread { id } }
}`;

/** Each directory's entries, named by a "sha:dir" variable so paths are never interpolated. */
const MAX_PAGES = 10;
const ghost: HostUser = { id: "ghost", name: "Deleted user" };

const toUser = (actor: { login: string; name?: string | null | undefined } | null): HostUser =>
  actor === null ? ghost : { id: actor.login, name: actor.name?.trim() || actor.login };

const toComment = (comment: GitHubThreadComment): ThreadComment => ({
  id: comment.id,
  author: toUser(comment.author),
  body: comment.body,
  createdAt: comment.createdAt,
  originalCommit: comment.originalCommit?.oid ?? null,
});

export const toThread = (thread: GitHubReviewThread): ReviewThread | null => {
  const comments = thread.comments.nodes
    .map(toComment)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  if (comments.length === 0) return null;
  return {
    id: thread.id,
    path: thread.path,
    side: thread.diffSide === "LEFT" ? "old" : "new",
    line: thread.line,
    // GitHub gives a one-line thread a start line equal to its line.
    startLine:
      thread.startLine !== null && thread.line !== null && thread.startLine < thread.line
        ? thread.startLine
        : null,
    originalLine: thread.originalLine,
    resolved: thread.isResolved,
    resolvedBy: thread.resolvedBy === null ? null : toUser(thread.resolvedBy),
    outdated: thread.isOutdated,
    can: {
      reply: thread.viewerCanReply,
      resolve: thread.isResolved ? thread.viewerCanUnresolve : thread.viewerCanResolve,
    },
    comments,
  };
};

export const createGitHubReviewThreads = (
  options: GitHubClientOptions & { readonly logger: Logger },
): ReviewThreads => {
  const { logger } = options;
  const { octokit, read } = createGitHubClient(options);
  const write = { deadline: false };

  return {
    host: "github",

    getAttachment: (url) =>
      fetchAttachment(url, {
        token: options.token,
        userAgent: `megareviewer/${options.version}`,
        fetch: options.fetch ?? globalThis.fetch,
        timeoutMs: options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
      }),

    async getThreads(ref) {
      const threads: ReviewThread[] = [];
      let after: string | null = null;
      for (let page = 0; ; page += 1) {
        if (page === MAX_PAGES) {
          logger.warn(`Stopped after ${MAX_PAGES * 100} review threads; later ones are missing`, {
            pullRequest: ref.number,
          });
          break;
        }
        const cursor: string | null = after;
        const result: Result<GitHubThreadPage, HostError> = await read(
          "the review threads",
          GitHubThreadPage,
          (request): Promise<unknown> =>
            octokit.graphql(THREADS_QUERY, {
              owner: ref.repo.owner,
              repo: ref.repo.repo,
              number: ref.number,
              ...(cursor === null ? {} : { after: cursor }),
              request,
            }),
        );
        if (!result.ok) return result;
        const { pullRequest } = result.value.repository;
        for (const node of pullRequest.reviewThreads.nodes) {
          const thread = toThread(node);
          if (thread !== null) threads.push(thread);
        }
        const { hasNextPage, endCursor }: { hasNextPage: boolean; endCursor: string | null } =
          pullRequest.reviewThreads.pageInfo;
        if (!hasNextPage || endCursor === null) break;
        after = endCursor;
      }
      return ok({ threads });
    },

    async reply(_ref, threadId, body) {
      const reply = await read(
        "the reply",
        GitHubThreadReply,
        () => octokit.graphql(REPLY_MUTATION, { threadId, body }),
        write,
      );
      return reply.ok ? ok(toComment(reply.value.addPullRequestReviewThreadReply.comment)) : reply;
    },

    async comment(ref, comment) {
      const side = comment.side === "new" ? "RIGHT" : "LEFT";
      const posted = await read(
        "the comment",
        GitHubReviewCommentPosted,
        async () =>
          (
            await octokit.request("POST /repos/{owner}/{repo}/pulls/{pull_number}/comments", {
              owner: ref.repo.owner,
              repo: ref.repo.repo,
              pull_number: ref.number,
              commit_id: comment.headSha,
              path: comment.path,
              line: comment.line,
              side,
              ...(comment.startLine === undefined
                ? {}
                : { start_line: comment.startLine, start_side: side }),
              body: comment.body,
            })
          ).data,
        write,
      );
      return posted.ok ? ok(null) : posted;
    },

    async setResolved(_ref, threadId, resolved) {
      const result = await read(
        resolved ? "resolving the thread" : "reopening the thread",
        GitHubThreadResolution,
        () => octokit.graphql(resolved ? RESOLVE_MUTATION : UNRESOLVE_MUTATION, { threadId }),
        write,
      );
      return result.ok ? ok(null) : result;
    },
  };
};
