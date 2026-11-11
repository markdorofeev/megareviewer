import type { Logger, ReviewThreads } from "../../application/ports/index.ts";
import type {
  HostError,
  PullRequestRef,
  ReviewThread,
  ThreadComment,
} from "../../domain/review/index.ts";
import { err, ok } from "../../domain/shared/index.ts";
import { fetchAttachment } from "./attachments.ts";
import { API, createBitbucketClient, REQUEST_TIMEOUT_MS } from "./client.ts";
import { toHostUser } from "./map.ts";
import {
  BitbucketPage,
  BitbucketPullRequestSource,
  BitbucketRepositoryPermission,
  BitbucketThreadComment,
} from "./schemas.ts";

export interface BitbucketThreadsOptions {
  readonly username: string;
  readonly password: string;
  readonly logger: Logger;
  readonly fetch?: typeof fetch;
  readonly requestTimeoutMs?: number;
}

const segment = encodeURIComponent;
const repoUrl = (fullName: string): string =>
  `${API}/repositories/${fullName.split("/").map(segment).join("/")}`;
const pullRequestUrl = (ref: PullRequestRef): string =>
  `${repoUrl(`${ref.repo.owner}/${ref.repo.repo}`)}/pullrequests/${ref.number}`;

const toComment = (comment: BitbucketThreadComment): ThreadComment => ({
  id: String(comment.id),
  author: toHostUser(comment.user),
  body: comment.content.raw ?? "",
  createdAt: comment.created_on,
  // Bitbucket doesn't say which commit a comment was written on.
  originalCommit: null,
});

const byTime = (a: ThreadComment, b: ThreadComment) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;

/**
 * Threads from a PR's comments: each inline comment without a parent starts one, and a reply
 * joins the thread its chain of parents leads to. Deleted comments are left out; a thread whose
 * first comment was deleted keeps its place for the replies, and one with none left is dropped.
 */
export const toThreads = (comments: readonly BitbucketThreadComment[]): ReviewThread[] => {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const rootOf = (comment: BitbucketThreadComment): BitbucketThreadComment => {
    let current = comment;
    const seen = new Set<number>();
    while (current.parent !== undefined && !seen.has(current.id)) {
      seen.add(current.id);
      const parent = byId.get(current.parent.id);
      if (parent === undefined) break;
      current = parent;
    }
    return current;
  };
  const members = new Map<number, BitbucketThreadComment[]>();
  for (const comment of comments) {
    const root = rootOf(comment);
    if (root.inline === undefined) continue;
    members.set(root.id, [...(members.get(root.id) ?? []), comment]);
  }
  const threads: ReviewThread[] = [];
  for (const [rootId, chain] of members) {
    const root = byId.get(rootId);
    const inline = root?.inline;
    const shown = chain
      .filter((comment) => comment.deleted !== true)
      .map(toComment)
      .sort(byTime);
    if (root === undefined || inline === undefined || shown.length === 0) continue;
    const onNew = inline.to != null;
    const line = onNew ? inline.to : inline.from;
    const start = onNew ? inline.start_to : inline.start_from;
    threads.push({
      id: String(rootId),
      path: inline.path,
      side: onNew ? "new" : "old",
      line: line ?? null,
      startLine: start != null && line != null && start < line ? start : null,
      originalLine: line ?? null,
      resolved: root.resolution != null,
      resolvedBy: root.resolution == null ? null : toHostUser(root.resolution.user),
      outdated: inline.outdated === true || line == null,
      // Bitbucket lets anyone who can read a PR comment on it; it refuses what it doesn't allow.
      can: { reply: true, resolve: true },
      comments: shown,
    });
  }
  return threads;
};

const rejected = (message: string): HostError => ({
  kind: "rejected",
  message,
  retryAfterSeconds: null,
});

export const createBitbucketReviewThreads = (options: BitbucketThreadsOptions): ReviewThreads => {
  const client = createBitbucketClient({
    username: options.username,
    password: options.password,
    logger: options.logger,
    fetch: options.fetch ?? globalThis.fetch,
    requestTimeoutMs: options.requestTimeoutMs,
  });

  return {
    host: "bitbucket",

    getAttachment: (url) =>
      fetchAttachment(url, {
        authorization: `Basic ${Buffer.from(`${options.username}:${options.password}`).toString("base64")}`,
        userAgent: "megareviewer",
        fetch: options.fetch ?? globalThis.fetch,
        timeoutMs: options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
      }),

    async getThreads(ref) {
      const fullName = `${ref.repo.owner}/${ref.repo.repo}`;
      const [comments, permissions] = await Promise.all([
        client.pages(
          "the pull request's comments",
          BitbucketThreadComment,
          `${pullRequestUrl(ref)}/comments?${new URLSearchParams({ pagelen: "100" })}`,
        ),
        client.json(
          "your permission on the repository",
          BitbucketPage(BitbucketRepositoryPermission),
          // `/user/permissions/repositories` was removed and answers 404.
          `${API}/user/workspaces/${encodeURIComponent(ref.repo.owner)}/permissions/repositories?${new URLSearchParams({ q: `repository.full_name="${fullName}"` })}`,
        ),
      ]);
      if (!comments.ok) return comments;
      // Unknown is read-only: applying is the host's call anyway.
      const canApply =
        permissions.ok &&
        permissions.value.values.some(
          ({ permission }) => permission === "write" || permission === "admin",
        );
      return ok({ threads: toThreads(comments.value), canApply });
    },

    async reply(ref, threadId, body) {
      const comment = await client.json(
        "the reply",
        BitbucketThreadComment,
        `${pullRequestUrl(ref)}/comments`,
        {
          method: "POST",
          body: { content: { raw: body }, parent: { id: Number(threadId) } },
          call: "publish",
        },
      );
      return comment.ok ? ok(toComment(comment.value)) : comment;
    },

    async setResolved(ref, threadId, resolved) {
      const result = await client.send(
        `${pullRequestUrl(ref)}/comments/${segment(threadId)}/resolve`,
        { method: resolved ? "POST" : "DELETE", call: "publish" },
      );
      return result.ok ? ok(null) : result;
    },

    async applySuggestions(ref, commit) {
      const pullRequest = await client.json(
        "the pull request",
        BitbucketPullRequestSource,
        pullRequestUrl(ref),
      );
      if (!pullRequest.ok) return pullRequest;
      const { source, destination } = pullRequest.value;
      const head = source.commit?.hash;
      if (head === undefined || !commit.headSha.startsWith(head)) {
        return err(rejected("The branch has new commits since; nothing was committed."));
      }
      // A fork's branch lives in the fork; Bitbucket decides whether the credentials may push.
      const form = new URLSearchParams({
        message: commit.message,
        branch: source.branch.name,
        // Bitbucket refuses the commit when the branch's tip isn't this parent.
        parents: commit.headSha,
      });
      for (const file of commit.files) form.append(`/${file.path}`, file.content);
      const created = await client.send(
        `${repoUrl(source.repository?.full_name ?? destination.repository.full_name)}/src`,
        { method: "POST", form, call: "publish" },
      );
      if (!created.ok) {
        return created.error.kind === "rejected"
          ? err(
              rejected(
                `The branch has moved since; nothing was committed. ${created.error.message}`,
              ),
            )
          : created;
      }
      const sha = created.value?.split("/").at(-1) ?? "";
      return ok({ sha: /^[0-9a-f]{40}$/.test(sha) ? sha : null });
    },
  };
};
