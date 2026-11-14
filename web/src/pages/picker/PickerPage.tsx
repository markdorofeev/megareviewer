import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  type HostKind,
  HostKind as HostKinds,
  type PullRequestRef,
  type PullRequestSummary,
} from "../../../../src/domain/review/index.ts";
import {
  type ApiError,
  errorMessage,
  useApi,
  usePullRequests,
  useReviewActivity,
} from "../../api/index.ts";
import { useConnections } from "../../app/connections-context.tsx";
import { navigate, reviewPath } from "../../app/router.ts";
import { isTextEntry } from "../../lib/keymap.ts";
import { Button } from "../../ui/button.tsx";
import { HOST_NAMES, prLabel } from "./PullRequestList.tsx";
import { LINK_BUTTON, PullRequestLists, type RowFailure } from "./PullRequestLists.tsx";
import { ReviewActivityCard } from "./ReviewActivity.tsx";
import { type FormStart, UrlForm } from "./UrlForm.tsx";

/** The lists are read again when the tab comes back after this long. */
export const STALE_AFTER_MS = 2 * 60 * 1000;

const HOSTS: readonly HostKind[] = HostKinds.options;

/** A start from the field or a row, while it runs or after it failed. */
type Start = {
  readonly from: "form" | "row";
  readonly url: string;
  readonly ref: PullRequestRef;
  /** For a row: the list it's in. */
  readonly role: PullRequestSummary["role"] | null;
} & ({ readonly state: "starting" } | { readonly state: "failed"; readonly error: ApiError });

export const PickerPage = ({ now = Date.now }: { readonly now?: () => number }) => {
  const { client } = useApi();
  const connections = useConnections();
  const { status, checks, reportListed, setOpen } = connections;
  const lists = usePullRequests();
  const activity = useReviewActivity();
  const [start, setStart] = useState<Start | null>(null);
  const [announced, setAnnounced] = useState("");
  const attempt = useRef(0);
  const urlField = useRef<HTMLInputElement>(null);
  const lastRead = useRef<number | null>(null);

  const { refresh: refreshLists } = lists;
  const { refresh: refreshActivity } = activity;
  const readAgain = useCallback(() => {
    refreshLists();
    refreshActivity();
  }, [refreshLists, refreshActivity]);

  // Check again reads the lists and the activity again too.
  const seenChecks = useRef(checks);
  useEffect(() => {
    if (checks === seenChecks.current) return;
    seenChecks.current = checks;
    readAgain();
  }, [checks, readAgain]);

  useEffect(() => {
    if (lists.loading) return;
    lastRead.current = now();
    if (lists.pullRequests === null) return;
    const failed = new Set(lists.pullRequests.errors.map((failure) => failure.host));
    const counts: Partial<Record<HostKind, number>> = {};
    for (const host of HOSTS) {
      if (failed.has(host) || status?.hosts[host].configured !== true) continue;
      counts[host] = lists.pullRequests.items.filter((item) => item.ref.repo.host === host).length;
    }
    reportListed({ counts, atMs: now() });
  }, [lists.loading, lists.pullRequests, status, now, reportListed]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible" || lastRead.current === null) return;
      if (now() - lastRead.current > STALE_AFTER_MS) readAgain();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [now, readAgain]);

  useEffect(() => {
    const focusField = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTextEntry(event.target)) return;
      event.preventDefault();
      urlField.current?.focus();
      urlField.current?.select();
    };
    document.addEventListener("keydown", focusField);
    return () => document.removeEventListener("keydown", focusField);
  }, []);

  const open = async (
    url: string,
    ref: PullRequestRef,
    from: Start["from"],
    role: Start["role"],
  ) => {
    attempt.current += 1;
    const mine = attempt.current;
    setStart({ from, url, ref, role, state: "starting" });
    if (from === "row") setAnnounced(`Opening ${prLabel(ref)}`);
    const result = await client.startAnalysis({ url });
    if (attempt.current !== mine) return;
    if (result.ok) {
      navigate(reviewPath(result.value.analysisId));
      return;
    }
    setStart({ from, url, ref, role, state: "failed", error: result.error });
  };

  const cancel = useCallback((from: Start["from"]) => {
    attempt.current += 1;
    setStart(null);
    if (from === "form") urlField.current?.focus();
    else setAnnounced("Cancelled");
  }, []);

  // Esc stops waiting for a row; the focus stays on it.
  const startingRow = start?.state === "starting" && start.from === "row";
  useEffect(() => {
    if (!startingRow) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest("[data-slot=popover-content]")) {
        return;
      }
      cancel("row");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [startingRow, cancel]);

  const openConnections = () => setOpen(true);
  const failure = (failed: Start & { readonly state: "failed" }): ReactNode => {
    const prefix = `Couldn't open ${prLabel(failed.ref)}: `;
    if (failed.error.code === "host-not-configured") {
      return (
        <>
          {prefix}
          {HOST_NAMES[failed.ref.repo.host]} isn't configured.{" "}
          <Button variant="link" className={LINK_BUTTON} onClick={openConnections}>
            Open Connections
          </Button>
        </>
      );
    }
    return `${prefix}${errorMessage(failed.error)}`;
  };

  const formStart: FormStart | null =
    start?.from !== "form"
      ? null
      : start.state === "starting"
        ? {
            state: "starting",
            message: `Fetching ${prLabel(start.ref)} from ${HOST_NAMES[start.ref.repo.host]}…`,
            onCancel: () => cancel("form"),
          }
        : {
            state: "failed",
            message: failure(start),
            onRetry: () => void open(start.url, start.ref, "form", null),
          };

  const nowMs = now();
  const startingUrl = start?.state === "starting" && start.from === "row" ? start.url : null;
  const rowFailure: RowFailure | null =
    start?.state === "failed" && start.from === "row" && start.role !== null
      ? {
          role: start.role,
          message: failure(start),
          onRetry: () => void open(start.url, start.ref, "row", start.role),
        }
      : null;

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-4">
      <h1 className="sr-only">Pull requests</h1>
      <UrlForm
        inputRef={urlField}
        start={formStart}
        onSubmit={(url, ref) => void open(url, ref, "form", null)}
        onEdit={() => {
          if (start?.from === "form" && start.state === "failed") setStart(null);
        }}
      />
      <PullRequestLists
        status={status}
        list={lists.pullRequests}
        error={lists.error}
        rowFailure={rowFailure}
        startingUrl={startingUrl}
        nowMs={nowMs}
        onOpen={(item) => void open(item.url, item.ref, "row", item.role)}
        onRetry={readAgain}
        onOpenConnections={openConnections}
        onFix={() => setOpen(true, { focusCheckAgain: true })}
      />
      <ReviewActivityCard
        activity={activity.activity}
        error={activity.error}
        onRetry={refreshActivity}
        now={now}
      />
      <span className="sr-only" aria-live="polite">
        {announced}
      </span>
    </div>
  );
};
