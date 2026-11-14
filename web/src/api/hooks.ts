import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type {
  AnalysisView,
  PullRequestListResponse,
  StatusResponse,
} from "../../../contracts/index.ts";
import {
  type AnalysisId,
  inProgress,
  type ReviewActivity,
} from "../../../src/domain/review/index.ts";
import type { Result } from "../../../src/domain/shared/index.ts";
import type { ApiClient } from "./client.ts";
import type { ApiError } from "./errors.ts";
import type { AnalysisStreamEvent } from "./events.ts";

export interface Api {
  readonly client: ApiClient;
  readonly subscribe: (id: AnalysisId, onEvent: (event: AnalysisStreamEvent) => void) => () => void;
}

export const ApiContext = createContext<Api | null>(null);

export const useApi = (): Api => {
  const api = useContext(ApiContext);
  if (api === null) throw new Error("useApi needs an ApiContext provider");
  return api;
};

interface QueryState<T> {
  readonly data: T | null;
  readonly error: ApiError | null;
  readonly loading: boolean;
}

const LOADING = { data: null, error: null, loading: true } as const;

/** Keeps the last data on a failed refresh, so the page doesn't go blank. */
const useQuery = <T>(load: () => Promise<Result<T, ApiError>>) => {
  const [state, setState] = useState<QueryState<T>>(LOADING);
  const [generation, setGeneration] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new generation reloads.
  useEffect(() => {
    let current = true;
    setState((previous) => ({ ...previous, loading: true }));
    void load().then((result) => {
      if (!current) return;
      setState((previous) =>
        result.ok
          ? { data: result.value, error: null, loading: false }
          : { data: previous.data, error: result.error, loading: false },
      );
    });
    return () => {
      current = false;
    };
  }, [load, generation]);
  const refresh = useCallback(() => setGeneration((count) => count + 1), []);
  return { ...state, refresh };
};

export const useStatus = () => {
  const { client } = useApi();
  const { data, ...rest } = useQuery<StatusResponse>(
    useCallback(() => client.getStatus(), [client]),
  );
  return { status: data, ...rest };
};

export const usePullRequests = () => {
  const { client } = useApi();
  const { data, ...rest } = useQuery<PullRequestListResponse>(
    useCallback(() => client.listPullRequests(), [client]),
  );
  return { pullRequests: data, ...rest };
};

export const useReviewActivity = () => {
  const { client } = useApi();
  const { data, ...rest } = useQuery<ReviewActivity>(
    useCallback(() => client.getReviewActivity(), [client]),
  );
  return { activity: data, ...rest };
};

/** Refetches arrive in bursts, one per stage event; this coalesces them. */
export const REFETCH_DEBOUNCE_MS = 100;

/** An analysis view that follows the analysis's events until it is complete or failed. */
export const useAnalysisView = (id: AnalysisId) => {
  const { client, subscribe } = useApi();
  const [state, setState] = useState<{
    readonly view: AnalysisView | null;
    readonly error: ApiError | null;
    readonly loading: boolean;
  }>({ view: null, error: null, loading: true });
  // Only the newest request may update the state, so responses can't land out of order.
  const latest = useRef(0);
  const lastView = useRef<AnalysisView | null>(null);
  // Following again, after a model run starts on an analysis whose stream had ended.
  const [round, setRound] = useState(0);
  const followed = useRef<AnalysisId | null>(null);

  const refetch = useCallback(async () => {
    latest.current += 1;
    const request = latest.current;
    const result = await client.getAnalysis(id);
    if (request !== latest.current) return;
    if (result.ok) lastView.current = result.value;
    setState((previous) =>
      result.ok
        ? { view: result.value, error: null, loading: false }
        : { view: previous.view, error: result.error, loading: false },
    );
  }, [client, id]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new round follows again.
  useEffect(() => {
    // Only another analysis starts from nothing; following the same one again keeps the view.
    if (followed.current !== id) {
      followed.current = id;
      lastView.current = null;
      setState({ view: null, error: null, loading: true });
    }
    void refetch();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribe(id, (event) => {
      clearTimeout(timer);
      if (event.type === "changed") {
        timer = setTimeout(() => void refetch(), REFETCH_DEBOUNCE_MS);
        return;
      }
      // A view that already shows the end needs no refetch: opening a complete analysis
      // gets `done` straight away.
      const shown = lastView.current;
      if (shown !== null && !inProgress(shown.analysis)) return;
      void refetch();
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
      latest.current += 1;
    };
  }, [id, refetch, subscribe, round]);

  /** Follows the analysis's events again, as after starting a model run on it. */
  const follow = useCallback(() => setRound((count) => count + 1), []);

  return { ...state, refetch, follow };
};

/** A call that changes something, with its pending state and last error. */
export const useMutation = <Args extends readonly unknown[], T>(
  fn: (...args: Args) => Promise<Result<T, ApiError>>,
) => {
  const [state, setState] = useState<{
    readonly pending: boolean;
    readonly error: ApiError | null;
  }>({ pending: false, error: null });
  const run = useCallback(
    async (...args: Args): Promise<Result<T, ApiError>> => {
      setState({ pending: true, error: null });
      const result = await fn(...args);
      setState({ pending: false, error: result.ok ? null : result.error });
      return result;
    },
    [fn],
  );
  const reset = useCallback(() => setState({ pending: false, error: null }), []);
  return { ...state, run, reset };
};
