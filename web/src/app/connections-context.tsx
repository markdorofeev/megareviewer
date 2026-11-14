import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { StatusResponse } from "../../../contracts/index.ts";
import { type ApiError, useStatus } from "../api/index.ts";
import type { Listed } from "./connections.ts";

export interface ConnectionsContextValue {
  readonly status: StatusResponse | null;
  readonly error: ApiError | null;
  /** The status is being read, the first time or again. */
  readonly checking: boolean;
  readonly checkedAtMs: number | null;
  readonly listed: Listed | null;
  /** The picker says how many PRs each host listed, for the hosts' rows. */
  readonly reportListed: (listed: Listed | null) => void;
  /** Reads the status again, and bumps `checks` so a page reads what it shows again too. */
  readonly checkAgain: () => void;
  readonly checks: number;
  readonly open: boolean;
  /** Opens or closes the popover; `focusCheckAgain` puts the focus on its Check again. */
  readonly setOpen: (open: boolean, options?: { readonly focusCheckAgain?: boolean }) => void;
  readonly focusCheckAgain: boolean;
}

const ConnectionsContext = createContext<ConnectionsContextValue | null>(null);

export const useConnections = (): ConnectionsContextValue => {
  const value = useContext(ConnectionsContext);
  if (value === null) throw new Error("useConnections needs a ConnectionsProvider");
  return value;
};

/** The status, read once for every page, and the Connections popover's state. */
export const ConnectionsProvider = ({
  children,
  now = Date.now,
}: {
  readonly children: ReactNode;
  readonly now?: () => number;
}) => {
  const { status, error, loading, refresh } = useStatus();
  const [checkedAtMs, setCheckedAtMs] = useState<number | null>(null);
  const [listed, setListed] = useState<Listed | null>(null);
  const [checks, setChecks] = useState(0);
  const [open, setOpenState] = useState(false);
  const [focusCheckAgain, setFocusCheckAgain] = useState(false);

  useEffect(() => {
    if (!loading && status !== null) setCheckedAtMs(now());
  }, [loading, status, now]);

  const checkAgain = useCallback(() => {
    refresh();
    setChecks((count) => count + 1);
  }, [refresh]);

  const setOpen = useCallback((next: boolean, options?: { readonly focusCheckAgain?: boolean }) => {
    setFocusCheckAgain(next && options?.focusCheckAgain === true);
    setOpenState(next);
  }, []);

  const value = useMemo(
    (): ConnectionsContextValue => ({
      status,
      error,
      checking: loading,
      checkedAtMs,
      listed,
      reportListed: setListed,
      checkAgain,
      checks,
      open,
      setOpen,
      focusCheckAgain,
    }),
    [
      status,
      error,
      loading,
      checkedAtMs,
      listed,
      checkAgain,
      checks,
      open,
      setOpen,
      focusCheckAgain,
    ],
  );
  return <ConnectionsContext.Provider value={value}>{children}</ConnectionsContext.Provider>;
};
