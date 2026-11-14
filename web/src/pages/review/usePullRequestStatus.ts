import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalysisId, PullRequestStatus } from "../../../../src/domain/review/index.ts";
import { type ApiError, useApi } from "../../api/index.ts";

/** How often the status is read again while a check is running and the tab is in view. */
export const RUNNING_REFRESH_MS = 60_000;

export interface PullRequestStatusRead {
  /** null until the first read answers. A later failed read keeps the last one. */
  readonly status: PullRequestStatus | null;
  /** Why the last read failed, or null. */
  readonly error: ApiError | null;
  readonly reload: () => void;
}

/**
 * Where the PR stands on its host, read live: when the page opens, when the window is back in
 * focus, after a publish (the caller reloads), and every minute while a check runs and the tab
 * is visible. No polling otherwise: a host's rate limit is shared with the rest of the tool.
 */
export const usePullRequestStatus = (analysisId: AnalysisId): PullRequestStatusRead => {
  const { client } = useApi();
  const [status, setStatus] = useState<PullRequestStatus | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const latest = useRef(0);

  const reload = useCallback(() => {
    latest.current += 1;
    const request = latest.current;
    void client.getPullRequestStatus(analysisId).then((result) => {
      if (request !== latest.current) return;
      if (result.ok) {
        setStatus(result.value);
        setError(null);
      } else {
        setError(result.error);
      }
    });
  }, [client, analysisId]);

  useEffect(() => {
    reload();
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [reload]);

  const running = status?.checks?.some((check) => check.state === "running") === true;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, RUNNING_REFRESH_MS);
    return () => clearInterval(timer);
  }, [running, reload]);

  return { status, error, reload };
};
