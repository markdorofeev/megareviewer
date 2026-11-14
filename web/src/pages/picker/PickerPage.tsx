import { GitPullRequestIcon, InboxIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { PullRequestListResponse, StatusResponse } from "../../../../contracts/index.ts";
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
import { cn } from "../../lib/utils.ts";
import { DANGER, WARNING } from "../../review/index.ts";
import { Button } from "../../ui/button.tsx";
import { HOST_NAMES, PullRequestList, prLabel } from "./PullRequestList.tsx";
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

const NOTE = "mx-3 mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-caption";
const LINK_BUTTON = "h-6 min-w-6 px-1 text-caption";

const hostNames = (hosts: readonly HostKind[]): string =>
  hosts.map((host) => HOST_NAMES[host]).join(" and ");

/** Which hosts are listed, hidden or failed, from the status and the list. */
const hostsOf = (status: StatusResponse | null, list: PullRequestListResponse | null) => {
  const configured = status === null ? [] : HOSTS.filter((host) => status.hosts[host].configured);
  // Failing in Connections already: its note sends the reviewer there.
  const failing = configured.filter((host) => status?.hosts[host].error != null);
  const listFailed = (list?.errors ?? []).filter((failure) => !failing.includes(failure.host));
  const shown = configured.filter(
    (host) => !failing.includes(host) && !listFailed.some((failure) => failure.host === host),
  );
  return { configured, failing, listFailed, shown };
};

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
  const list = lists.pullRequests;
  const hosts = hostsOf(status, list);
  const noHost = status !== null && hosts.configured.length === 0;
  const everyHostFailed = list !== null && hosts.configured.length > 0 && hosts.shown.length === 0;
  const onlyOne =
    hosts.configured.length > 1 && hosts.shown.length === 1 && hosts.shown[0] !== undefined
      ? `${HOST_NAMES[hosts.shown[0]]} only`
      : null;
  const startingUrl = start?.state === "starting" && start.from === "row" ? start.url : null;
  const openRow = (item: PullRequestSummary) => void open(item.url, item.ref, "row", item.role);

  const requestFailed =
    lists.error === null ? null : (
      <p className={cn(DANGER, NOTE)} role="alert">
        <span className="font-medium">Couldn't list pull requests.</span>
        <span>{errorMessage(lists.error)}</span>
        <Button variant="link" className={LINK_BUTTON} onClick={readAgain}>
          Retry
        </Button>
      </p>
    );

  const rowFailed = (role: PullRequestSummary["role"]) =>
    start?.state === "failed" && start.from === "row" && start.role === role ? (
      <p className={cn(DANGER, NOTE)} role="alert">
        <span>{failure(start)}</span>
        <Button
          variant="link"
          className={LINK_BUTTON}
          onClick={() => void open(start.url, start.ref, "row", start.role)}
        >
          Try again
        </Button>
      </p>
    ) : null;

  const failingNotes = hosts.failing.map((host) => (
    <p key={host} className={cn(WARNING, NOTE)} role="status">
      <span>
        {HOST_NAMES[host]} pull requests are hidden until {HOST_NAMES[host]} works again.
      </span>
      <Button
        variant="link"
        className={LINK_BUTTON}
        onClick={() => setOpen(true, { focusCheckAgain: true })}
      >
        Fix…
      </Button>
    </p>
  ));

  const listFailedNotes = hosts.listFailed.map((failed) => (
    <p key={failed.host} className={cn(DANGER, NOTE)} role="alert">
      <span className="font-medium">Couldn't load {HOST_NAMES[failed.host]} pull requests.</span>
      <span>{failed.message}</span>
      {hosts.shown.length > 0 && <span>{hostNames(hosts.shown)} pull requests are shown.</span>}
      <Button variant="link" className={LINK_BUTTON} onClick={readAgain}>
        Retry
      </Button>
    </p>
  ));

  const loadingFrom =
    hosts.configured.length === 0 ? "Loading" : `Loading from ${hostNames(hosts.configured)}`;
  const reviewItems = list?.items.filter((item) => item.role === "reviewer") ?? null;
  const ownItems = list?.items.filter((item) => item.role === "author") ?? null;
  const countOf = (items: readonly PullRequestSummary[] | null) =>
    items === null ? (lists.error === null ? "…" : null) : everyHostFailed ? null : items.length;
  const blockedMessage = (text: string, action?: ReactNode) => (
    <div className="flex flex-col items-center gap-2 px-6 py-8 text-center text-caption text-muted-foreground">
      <p>{text}</p>
      {action}
    </div>
  );

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
      <div className="grid items-start gap-4 lg:grid-cols-[1.55fr_1fr]">
        <PullRequestList
          title="To review"
          word={onlyOne ?? "Waiting for your review"}
          items={reviewItems}
          count={countOf(reviewItems)}
          loading={loadingFrom}
          skeletonRows={5}
          notes={
            <>
              {list !== null && requestFailed}
              {failingNotes}
              {listFailedNotes}
              {rowFailed("reviewer")}
            </>
          }
          blocked={
            noHost
              ? blockedMessage(
                  "Connect GitHub or Bitbucket to list pull requests.",
                  <Button variant="outline" size="sm" onClick={openConnections}>
                    Open Connections
                  </Button>,
                )
              : list === null && lists.error !== null
                ? requestFailed
                : everyHostFailed
                  ? false
                  : undefined
          }
          empty={{
            icon: InboxIcon,
            title: "Nothing is waiting for you",
            text: "When someone asks for your review on GitHub or Bitbucket, it appears here. To review something else, paste its link above.",
          }}
          nowMs={nowMs}
          startingUrl={startingUrl}
          onOpen={openRow}
        />
        <PullRequestList
          title="Your pull requests"
          word={onlyOne ?? "Open"}
          items={ownItems}
          count={countOf(ownItems)}
          loading="Loading"
          skeletonRows={3}
          notes={
            <>
              {list !== null && requestFailed}
              {rowFailed("author")}
            </>
          }
          blocked={
            noHost
              ? blockedMessage("Connect GitHub or Bitbucket to list pull requests.")
              : list === null && lists.error !== null
                ? requestFailed
                : everyHostFailed
                  ? blockedMessage("Couldn't load pull requests.")
                  : undefined
          }
          empty={{
            icon: GitPullRequestIcon,
            title: "No open pull requests",
            text: "Pull requests you open on GitHub or Bitbucket appear here.",
          }}
          nowMs={nowMs}
          startingUrl={startingUrl}
          onOpen={openRow}
        />
      </div>
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
