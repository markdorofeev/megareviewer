import type { Logger, ReviewThreads } from "../../application/ports/index.ts";
import type {
  HostError,
  HostUser,
  RepoRef,
  ReviewThread,
  ThreadComment,
} from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import { fetchAttachment } from "./attachments.ts";
import { createGitHubClient, type GitHubClientOptions, REQUEST_TIMEOUT_MS } from "./client.ts";
import {
  GitHubGitCommit,
  GitHubGitObject,
  GitHubPullRequestHead,
  type GitHubReviewThread,
  type GitHubThreadComment,
  GitHubThreadPage,
  GitHubThreadReply,
  GitHubThreadResolution,
  GitHubTrees,
} from "./schemas.ts";

const COMMENT_FIELDS =
  "id body createdAt author { login ... on User { name } } originalCommit { oid }";

/** A PR's review threads, 100 at a time, with each thread's first 100 comments. */
export const THREADS_QUERY = `query ($owner: String!, $repo: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      viewerCanUpdate
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
export const treesQuery = (count: number): string => {
  const indexes = Array.from({ length: count }, (_, i) => i);
  const variables = indexes.map((i) => `$e${i}: String!`).join(", ");
  const objects = indexes
    .map((i) => `d${i}: object(expression: $e${i}) { ... on Tree { entries { name mode } } }`)
    .join("\n    ");
  return `query ($owner: String!, $repo: String!, ${variables}) {\n  repository(owner: $owner, name: $repo) {\n    ${objects}\n  }\n}`;
};

/** Pages of threads read before giving up and logging. */
const MAX_PAGES = 10;
/** git's file modes, as GraphQL gives them (decimal) and as the trees API takes them. */
const EXECUTABLE = 0o100755;

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

const rejected = (message: string): HostError => ({
  kind: "rejected",
  message,
  retryAfterSeconds: null,
});

const directoryOf = (path: string): string => path.split("/").slice(0, -1).join("/");
const nameOf = (path: string): string => path.split("/").at(-1) ?? path;

export const createGitHubReviewThreads = (
  options: GitHubClientOptions & { readonly logger: Logger },
): ReviewThreads => {
  const { logger } = options;
  const { octokit, read } = createGitHubClient(options);
  const write = { deadline: false };

  /** Each file's mode at a commit, so a commit keeps an executable bit; 100644 when unknown. */
  const modesAt = async (
    repo: RepoRef,
    sha: string,
    paths: readonly string[],
  ): Promise<Result<ReadonlyMap<string, string>, HostError>> => {
    const directories = [...new Set(paths.map(directoryOf))];
    const trees = await read(`${directories.length} directories`, GitHubTrees, (request) =>
      octokit.graphql(treesQuery(directories.length), {
        owner: repo.owner,
        repo: repo.repo,
        ...Object.fromEntries(directories.map((dir, i) => [`e${i}`, `${sha}:${dir}`])),
        request,
      }),
    );
    if (!trees.ok) return trees;
    const modes = new Map<string, string>();
    for (const path of paths) {
      const at = directories.indexOf(directoryOf(path));
      const entry = trees.value.repository[`d${at}`]?.entries?.find(
        (one) => one.name === nameOf(path),
      );
      modes.set(path, entry?.mode === EXECUTABLE ? "100755" : "100644");
    }
    return ok(modes);
  };

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
      let canApply = false;
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
        canApply = pullRequest.viewerCanUpdate;
        for (const node of pullRequest.reviewThreads.nodes) {
          const thread = toThread(node);
          if (thread !== null) threads.push(thread);
        }
        const { hasNextPage, endCursor }: { hasNextPage: boolean; endCursor: string | null } =
          pullRequest.reviewThreads.pageInfo;
        if (!hasNextPage || endCursor === null) break;
        after = endCursor;
      }
      return ok({ threads, canApply });
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

    async setResolved(_ref, threadId, resolved) {
      const result = await read(
        resolved ? "resolving the thread" : "reopening the thread",
        GitHubThreadResolution,
        () => octokit.graphql(resolved ? RESOLVE_MUTATION : UNRESOLVE_MUTATION, { threadId }),
        write,
      );
      return result.ok ? ok(null) : result;
    },

    async applySuggestions(ref, commit) {
      const pullRequest = await read("the pull request", GitHubPullRequestHead, async (request) => {
        return (
          await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
            owner: ref.repo.owner,
            repo: ref.repo.repo,
            pull_number: ref.number,
            request,
          })
        ).data;
      });
      if (!pullRequest.ok) return pullRequest;
      const { head } = pullRequest.value;
      if (head.sha !== commit.headSha) {
        return err(rejected("The branch has new commits since; nothing was committed."));
      }
      if (head.repo === null) {
        return err(rejected("The pull request's branch is gone: its fork was deleted."));
      }
      // A fork's branch lives in the fork; GitHub decides whether the token may push there.
      const repo: RepoRef = { host: "github", owner: head.repo.owner.login, repo: head.repo.name };
      const target = { owner: repo.owner, repo: repo.repo };

      const modes = await modesAt(
        repo,
        commit.headSha,
        commit.files.map((file) => file.path),
      );
      if (!modes.ok) return modes;
      const base = await read("the head commit", GitHubGitCommit, async (request) => {
        return (
          await octokit.request("GET /repos/{owner}/{repo}/git/commits/{commit_sha}", {
            ...target,
            commit_sha: commit.headSha,
            request,
          })
        ).data;
      });
      if (!base.ok) return base;

      const tree: { path: string; mode: "100644" | "100755"; type: "blob"; sha: string }[] = [];
      for (const file of commit.files) {
        const blob = await read(
          `the new ${file.path}`,
          GitHubGitObject,
          async () =>
            (
              await octokit.request("POST /repos/{owner}/{repo}/git/blobs", {
                ...target,
                content: file.content,
                encoding: "utf-8",
              })
            ).data,
          write,
        );
        if (!blob.ok) return blob;
        const mode = modes.value.get(file.path) === "100755" ? "100755" : "100644";
        tree.push({ path: file.path, mode, type: "blob", sha: blob.value.sha });
      }
      const newTree = await read(
        "the new tree",
        GitHubGitObject,
        async () =>
          (
            await octokit.request("POST /repos/{owner}/{repo}/git/trees", {
              ...target,
              base_tree: base.value.tree.sha,
              tree,
            })
          ).data,
        write,
      );
      if (!newTree.ok) return newTree;
      const created = await read(
        "the new commit",
        GitHubGitObject,
        async () =>
          (
            await octokit.request("POST /repos/{owner}/{repo}/git/commits", {
              ...target,
              message: commit.message,
              tree: newTree.value.sha,
              parents: [commit.headSha],
            })
          ).data,
        write,
      );
      if (!created.ok) return created;
      // Without force, GitHub refuses unless the branch is still at the commit's parent. Octokit
      // would encode a branch's slashes as one parameter, so its segments go in as they are.
      const branch = head.ref.split("/").map(encodeURIComponent).join("/");
      const moved = await read(
        "the branch",
        GitHubGitObject.partial(),
        async () =>
          (
            await octokit.request(`PATCH /repos/{owner}/{repo}/git/refs/heads/${branch}`, {
              ...target,
              sha: created.value.sha,
              force: false,
            })
          ).data,
        write,
      );
      if (!moved.ok) {
        return moved.error.kind === "rejected"
          ? err(
              rejected(`The branch has moved since; nothing was committed. ${moved.error.message}`),
            )
          : moved;
      }
      return ok({ sha: created.value.sha });
    },
  };
};
