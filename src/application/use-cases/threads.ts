import {
  type Analysis,
  type AnalysisId,
  commentFits,
  composeBody,
  type HunkComment,
  type ThreadComment,
  type ThreadId,
  type ThreadList,
} from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import type { Attachment, ReviewThreads } from "../ports/index.ts";
import { hostFor } from "./analyses.ts";
import type { AppDeps } from "./deps.ts";
import { appError, fromHostError, type UseCaseError } from "./errors.ts";

/** Attachments kept in memory at most, all together: a few screen recordings. */
export const MAX_CACHED_ATTACHMENT_BYTES = 100 * 1024 * 1024;

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
      if (!reply.ok) return err(fromHostError(reply.error));
      await deps.store.recordThreadPost(id, "reply");
      return reply;
    },

    /**
     * One comment on lines of the diff, posted now as a thread of its own. Like publishing, it
     * goes on the head the reviewer looked at or nowhere, since lines are anchored on it.
     */
    async postComment(id: AnalysisId, comment: HunkComment): Promise<Result<null, UseCaseError>> {
      const found = await threadsFor(id);
      if (!found.ok) return found;
      const { analysis, threads } = found.value;
      if (analysis.status !== "complete") {
        return err(appError("analysis-not-complete", "The analysis isn't complete"));
      }
      const hunks = new Map(
        analysis.files.flatMap((file) => file.hunks.map((hunk) => [hunk.id, hunk] as const)),
      );
      const hunk = hunks.get(comment.hunkId);
      if (hunk === undefined || !commentFits(hunks, comment)) {
        return err(
          appError(
            "bad-request",
            `The comment is on ${comment.side} line ${comment.line} of hunk ${comment.hunkId}, which the diff doesn't show`,
          ),
        );
      }
      const body = composeBody(comment);
      if (body === "") return err(appError("bad-request", "The comment has no text"));

      const { ref, headSha } = analysis.key;
      const host = hostFor(deps, ref.repo.host);
      if (!host.ok) return host;
      const current = await host.value.getPullRequest(ref);
      if (!current.ok) return err(fromHostError(current.error));
      if (current.value.headSha !== headSha) {
        return err(
          appError("stale-analysis", "The pull request has new commits since this analysis"),
        );
      }
      const posted = await threads.comment(ref, {
        path: hunk.path,
        side: comment.side,
        line: comment.line,
        ...(comment.startLine === undefined ? {} : { startLine: comment.startLine }),
        body,
        headSha,
      });
      if (!posted.ok) return err(fromHostError(posted.error));
      await deps.store.recordThreadPost(id, "comment");
      return ok(null);
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
  };
};
