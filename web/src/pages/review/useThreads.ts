import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AnalysisId,
  ThreadCommentId,
  ThreadId,
  ThreadList,
} from "../../../../src/domain/review/index.ts";
import { type ApiError, errorMessage, useApi } from "../../api/index.ts";

export interface Threads {
  /** null until the first read answers, and when it failed. */
  readonly list: ThreadList | null;
  /** Why the last read failed: a warning above the code, never a failed page. */
  readonly error: ApiError | null;
  readonly reload: () => void;
  /** Posts a reply; an error message, or null once it's posted. */
  readonly reply: (threadId: ThreadId, body: string) => Promise<string | null>;
  readonly resolve: (threadId: ThreadId, resolved: boolean) => Promise<string | null>;
  /** Commits suggestions in one commit; the new commit, or an error. */
  readonly apply: (
    commentIds: readonly ThreadCommentId[],
  ) => Promise<
    | { readonly ok: true; readonly sha: string | null }
    | { readonly ok: false; readonly error: ApiError }
  >;
}

/**
 * The PR's review threads, read live: once the page opens and again after each write, since
 * threads change without a push. Writes go out at once and are never retried.
 */
export const useThreads = (analysisId: AnalysisId, enabled: boolean): Threads => {
  const { client } = useApi();
  const [list, setList] = useState<ThreadList | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const latest = useRef(0);

  const reload = useCallback(() => {
    latest.current += 1;
    const request = latest.current;
    void client.getThreads(analysisId).then((result) => {
      if (request !== latest.current) return;
      if (result.ok) {
        setList(result.value);
        setError(null);
      } else {
        setError(result.error);
      }
    });
  }, [client, analysisId]);

  useEffect(() => {
    if (enabled) reload();
  }, [enabled, reload]);

  const reply = useCallback(
    async (threadId: ThreadId, body: string) => {
      const result = await client.replyToThread(analysisId, threadId, { body });
      if (!result.ok) return errorMessage(result.error);
      reload();
      return null;
    },
    [client, analysisId, reload],
  );

  const resolve = useCallback(
    async (threadId: ThreadId, resolved: boolean) => {
      const result = await client.resolveThread(analysisId, threadId, { resolved });
      if (!result.ok) return errorMessage(result.error);
      reload();
      return null;
    },
    [client, analysisId, reload],
  );

  const apply = useCallback(
    async (commentIds: readonly ThreadCommentId[]) => {
      const result = await client.applySuggestions(analysisId, { commentIds });
      reload();
      return result.ok
        ? ({ ok: true, sha: result.value.sha } as const)
        : ({ ok: false, error: result.error } as const);
    },
    [client, analysisId, reload],
  );

  return { list, error, reload, reply, resolve, apply };
};
