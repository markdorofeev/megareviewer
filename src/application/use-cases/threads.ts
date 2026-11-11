import {
  type Analysis,
  type AnalysisId,
  applyEdits,
  type LineEdit,
  type ReviewThread,
  suggestionOf,
  type ThreadComment,
  type ThreadCommentId,
  type ThreadId,
  type ThreadList,
  threadLines,
} from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import type { Attachment, ReviewThreads } from "../ports/index.ts";
import { hostFor } from "./analyses.ts";
import type { AppDeps } from "./deps.ts";
import { appError, fromHostError, type UseCaseError } from "./errors.ts";

export interface AppliedSuggestions {
  readonly sha: string | null;
  readonly paths: readonly string[];
}

/** Attachments kept in memory at most, all together: a few screen recordings. */
export const MAX_CACHED_ATTACHMENT_BYTES = 100 * 1024 * 1024;

/** "Apply suggestion from code review", or "Apply 3 suggestions from code review". */
export const applyMessage = (count: number): string =>
  count === 1 ? "Apply suggestion from code review" : `Apply ${count} suggestions from code review`;

interface Suggestion {
  readonly thread: ReviewThread;
  readonly comment: ThreadComment;
  readonly edit: LineEdit;
}

/** A suggestion comment's edit, or why it can't be applied. */
const suggestionIn = (
  threads: readonly ReviewThread[],
  commentId: ThreadCommentId,
): Result<Suggestion, string> => {
  for (const thread of threads) {
    const comment = thread.comments.find((one) => one.id === commentId);
    if (comment === undefined) continue;
    const lines = suggestionOf(comment.body);
    const range = threadLines(thread);
    if (lines === null) return err(`Comment ${commentId} doesn't suggest a change`);
    if (thread.outdated || range === null || thread.side !== "new") {
      return err(`The suggestion in comment ${commentId} is on code that has changed since`);
    }
    return ok({ thread, comment, edit: { ...range, lines } });
  }
  return err(`No comment ${commentId} on this pull request`);
};

/** The conversation on a PR's code: read live from its host, written at once. */
export const createThreadUseCases = (deps: AppDeps) => {
  const getAnalysis = async (id: AnalysisId): Promise<Result<Analysis, UseCaseError>> => {
    const analysis = await deps.store.getAnalysis(id);
    return analysis === null ? err(appError("not-found", `No analysis ${id}`)) : ok(analysis);
  };

  const threadsFor = async (
    id: AnalysisId,
  ): Promise<Result<{ analysis: Analysis; threads: ReviewThreads }, UseCaseError>> => {
    const analysis = await getAnalysis(id);
    if (!analysis.ok) return analysis;
    const host = analysis.value.key.ref.repo.host;
    const threads = deps.threads[host];
    if (threads === undefined) {
      return err(appError("host-not-configured", `${host} isn't configured`));
    }
    return ok({ analysis: analysis.value, threads });
  };

  // Attachments recently served, newest last: a video player asks for one in many ranges as it
  // seeks, and an attachment's URL names its content, so it never changes.
  const attachments = new Map<string, Promise<Result<Attachment, UseCaseError>>>();
  /** The sizes of those that arrived, by URL. */
  const sizes = new Map<string, number>();
  const cachedBytes = () => [...sizes.values()].reduce((sum, size) => sum + size, 0);
  const remember = (url: string, attachment: Promise<Result<Attachment, UseCaseError>>) => {
    attachments.set(url, attachment);
    void attachment.then((result) => {
      if (attachments.get(url) !== attachment) return;
      // A failure isn't kept, so the next request asks the host again.
      if (!result.ok) {
        attachments.delete(url);
        return;
      }
      sizes.set(url, result.value.bytes.byteLength);
      for (const oldest of attachments.keys()) {
        if (cachedBytes() <= MAX_CACHED_ATTACHMENT_BYTES || oldest === url) break;
        attachments.delete(oldest);
        sizes.delete(oldest);
      }
    });
  };

  /** One apply per analysis at a time, so a double click can't commit twice. */
  const applying = new Map<AnalysisId, Promise<Result<AppliedSuggestions, UseCaseError>>>();

  const apply = async (
    analysis: Analysis,
    threads: ReviewThreads,
    commentIds: readonly ThreadCommentId[],
  ): Promise<Result<AppliedSuggestions, UseCaseError>> => {
    const { ref, headSha } = analysis.key;
    const host = hostFor(deps, ref.repo.host);
    if (!host.ok) return host;
    // The commit goes on the head the reviewer looked at, or nowhere.
    const current = await host.value.getPullRequest(ref);
    if (!current.ok) return err(fromHostError(current.error));
    if (current.value.headSha !== headSha) {
      return err(
        appError("stale-analysis", "The pull request has new commits since this analysis"),
      );
    }

    const list = await threads.getThreads(ref);
    if (!list.ok) return err(fromHostError(list.error));
    const suggestions: Suggestion[] = [];
    for (const commentId of new Set(commentIds)) {
      const found = suggestionIn(list.value.threads, commentId);
      if (!found.ok) return err(appError("bad-request", found.error));
      suggestions.push(found.value);
    }

    const byPath = new Map<string, Suggestion[]>();
    for (const one of suggestions) {
      byPath.set(one.thread.path, [...(byPath.get(one.thread.path) ?? []), one]);
    }
    const paths = [...byPath.keys()];
    const contents = await filesAt(analysis, paths);
    if (!contents.ok) return contents;
    const files: { path: string; content: string }[] = [];
    for (const [at, path] of paths.entries()) {
      const content = contents.value[at];
      const inFile = byPath.get(path) ?? [];
      if (content == null) {
        return err(appError("bad-request", `${path} isn't in the pull request's head commit`));
      }
      const edited = applyEdits(
        content,
        inFile.map((one) => one.edit),
      );
      if (!edited.ok) {
        const problem = inFile[edited.error.at];
        const where = `${path}:${problem?.edit.start ?? "?"}`;
        return err(
          appError(
            "bad-request",
            edited.error.kind === "overlap"
              ? `Two suggestions change ${where}; apply them one at a time`
              : `The suggestion on ${where} is past the end of the file`,
          ),
        );
      }
      files.push({ path, content: edited.value });
    }

    const committed = await threads.applySuggestions(ref, {
      headSha,
      message: applyMessage(suggestions.length),
      files,
    });
    if (!committed.ok) {
      return err(
        committed.error.kind === "rejected"
          ? appError("stale-analysis", committed.error.message)
          : fromHostError(committed.error),
      );
    }
    return ok({ sha: committed.value.sha, paths });
  };

  /** Files at the analysis's head: from the cache Collect filled, else from the host. */
  const filesAt = async (
    analysis: Analysis,
    paths: readonly string[],
  ): Promise<Result<readonly (string | null)[], UseCaseError>> => {
    const { repo } = analysis.key.ref;
    const at = paths.map((path) => ({ sha: analysis.key.headSha, path }));
    const cached = await Promise.all(at.map((file) => deps.fileCache.get(repo, file)));
    const missing = at.filter((_, index) => cached[index] === null);
    if (missing.length === 0) return ok(cached.map((one) => one?.content ?? null));
    const host = hostFor(deps, repo.host);
    if (!host.ok) return host;
    const fetched = await host.value.getFiles(repo, missing);
    if (!fetched.ok) return err(fromHostError(fetched.error));
    let next = 0;
    return ok(
      cached.map((one) => {
        if (one !== null) return one.content;
        const content = fetched.value[next] ?? null;
        next += 1;
        return content;
      }),
    );
  };

  return {
    /** An image or video pasted into the PR's comments, from its host's own store. */
    async getAttachment(id: AnalysisId, url: string): Promise<Result<Attachment, UseCaseError>> {
      const found = await threadsFor(id);
      if (!found.ok) return found;
      const known = attachments.get(url);
      if (known !== undefined) {
        // Newest last again.
        attachments.delete(url);
        attachments.set(url, known);
        return known;
      }
      const fetching = found.value.threads
        .getAttachment(url)
        .then((attachment) => (attachment.ok ? attachment : err(fromHostError(attachment.error))));
      remember(url, fetching);
      return fetching;
    },

    async getThreads(id: AnalysisId): Promise<Result<ThreadList, UseCaseError>> {
      const found = await threadsFor(id);
      if (!found.ok) return found;
      const list = await found.value.threads.getThreads(found.value.analysis.key.ref);
      return list.ok ? list : err(fromHostError(list.error));
    },

    async replyToThread(
      id: AnalysisId,
      threadId: ThreadId,
      body: string,
    ): Promise<Result<ThreadComment, UseCaseError>> {
      const found = await threadsFor(id);
      if (!found.ok) return found;
      const reply = await found.value.threads.reply(
        found.value.analysis.key.ref,
        threadId,
        body.trim(),
      );
      return reply.ok ? reply : err(fromHostError(reply.error));
    },

    async resolveThread(
      id: AnalysisId,
      threadId: ThreadId,
      resolved: boolean,
    ): Promise<Result<{ readonly resolved: boolean }, UseCaseError>> {
      const found = await threadsFor(id);
      if (!found.ok) return found;
      const result = await found.value.threads.setResolved(
        found.value.analysis.key.ref,
        threadId,
        resolved,
      );
      return result.ok ? ok({ resolved }) : err(fromHostError(result.error));
    },

    async applySuggestions(
      id: AnalysisId,
      commentIds: readonly ThreadCommentId[],
    ): Promise<Result<AppliedSuggestions, UseCaseError>> {
      const found = await threadsFor(id);
      if (!found.ok) return found;
      if (found.value.analysis.status !== "complete") {
        return err(appError("analysis-not-complete", "The analysis isn't complete"));
      }
      const running = applying.get(id);
      if (running !== undefined) return running;
      const attempt = apply(found.value.analysis, found.value.threads, commentIds).finally(() =>
        applying.delete(id),
      );
      applying.set(id, attempt);
      return attempt;
    },
  };
};
