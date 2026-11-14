import { GitPullRequestIcon, InboxIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { PullRequestListResponse, StatusResponse } from "../../../../contracts/index.ts";
import {
  type HostKind,
  HostKind as HostKinds,
  type PullRequestSummary,
} from "../../../../src/domain/review/index.ts";
import { type ApiError, errorMessage } from "../../api/index.ts";
import { cn } from "../../lib/utils.ts";
import { DANGER, WARNING } from "../../review/index.ts";
import { Button } from "../../ui/button.tsx";
import { HOST_NAMES, PullRequestList } from "./PullRequestList.tsx";

const HOSTS: readonly HostKind[] = HostKinds.options;

export const NOTE = "flex flex-wrap items-baseline gap-x-2 gap-y-1 text-caption";
export const LINK_BUTTON = "h-6 min-w-6 px-1 text-caption";

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

/** A start from a row that failed: said above the rows of the row's list. */
export interface RowFailure {
  readonly role: PullRequestSummary["role"];
  readonly message: ReactNode;
  readonly onRetry: () => void;
}

const blockedMessage = (text: string, action?: ReactNode) => (
  <div className="flex flex-col items-center gap-2 px-6 py-8 text-center text-caption text-muted-foreground">
    <p>{text}</p>
    {action}
  </div>
);

/** The two lists, To review and Your pull requests, in every state the hosts leave them. */
export const PullRequestLists = ({
  status,
  list,
  error,
  rowFailure,
  startingUrl,
  nowMs,
  onOpen,
  onRetry,
  onOpenConnections,
  onFix,
}: {
  readonly status: StatusResponse | null;
  /** null before the first read answers. */
  readonly list: PullRequestListResponse | null;
  /** The last read's failure, kept with the rows from before. */
  readonly error: ApiError | null;
  readonly rowFailure: RowFailure | null;
  readonly startingUrl: string | null;
  readonly nowMs: number;
  readonly onOpen: (item: PullRequestSummary) => void;
  readonly onRetry: () => void;
  readonly onOpenConnections: () => void;
  /** Opens Connections on Check again. */
  readonly onFix: () => void;
}) => {
  const hosts = hostsOf(status, list);
  const noHost = status !== null && hosts.configured.length === 0;
  const everyHostFailed = list !== null && hosts.configured.length > 0 && hosts.shown.length === 0;
  const onlyOne =
    hosts.configured.length > 1 && hosts.shown.length === 1 && hosts.shown[0] !== undefined
      ? `${HOST_NAMES[hosts.shown[0]]} only`
      : null;

  // One request reads both lists, so Retry is in the first only.
  const requestFailed = (retry: boolean) =>
    error === null ? null : (
      <p className={cn(DANGER, NOTE)} role="alert">
        <span className="font-medium">Couldn't list pull requests.</span>
        <span>{errorMessage(error)}</span>
        {retry && (
          <Button variant="link" className={LINK_BUTTON} onClick={onRetry}>
            Retry
          </Button>
        )}
      </p>
    );

  const rowFailed = (role: PullRequestSummary["role"]) =>
    rowFailure?.role === role ? (
      <p className={cn(DANGER, NOTE)} role="alert">
        <span>{rowFailure.message}</span>
        <Button variant="link" className={LINK_BUTTON} onClick={rowFailure.onRetry}>
          Try again
        </Button>
      </p>
    ) : null;

  const failingNotes = hosts.failing.map((host) => (
    <p key={host} className={cn(WARNING, NOTE)} role="status">
      <span>
        {HOST_NAMES[host]} pull requests are hidden until {HOST_NAMES[host]} works again.
      </span>
      <Button variant="link" className={LINK_BUTTON} onClick={onFix}>
        Fix…
      </Button>
    </p>
  ));

  const listFailedNotes = hosts.listFailed.map((failed) => (
    <p key={failed.host} className={cn(DANGER, NOTE)} role="alert">
      <span className="font-medium">Couldn't load {HOST_NAMES[failed.host]} pull requests.</span>
      <span>{failed.message}</span>
      {hosts.shown.length > 0 && <span>{hostNames(hosts.shown)} pull requests are shown.</span>}
      <Button variant="link" className={LINK_BUTTON} onClick={onRetry}>
        Retry
      </Button>
    </p>
  ));

  const loadingFrom =
    hosts.configured.length === 0 ? "Loading" : `Loading from ${hostNames(hosts.configured)}`;
  const reviewItems = list?.items.filter((item) => item.role === "reviewer") ?? null;
  const ownItems = list?.items.filter((item) => item.role === "author") ?? null;
  const countOf = (items: readonly PullRequestSummary[] | null) =>
    items === null ? (error === null ? "…" : null) : everyHostFailed ? null : items.length;

  return (
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
            {list !== null && requestFailed(true)}
            {failingNotes}
            {listFailedNotes}
            {rowFailed("reviewer")}
          </>
        }
        blocked={
          noHost
            ? blockedMessage(
                "Connect GitHub or Bitbucket to list pull requests.",
                <Button variant="outline" size="sm" onClick={onOpenConnections}>
                  Open Connections
                </Button>,
              )
            : list === null && error !== null
              ? requestFailed(true)
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
        onOpen={onOpen}
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
            {list !== null && requestFailed(false)}
            {rowFailed("author")}
          </>
        }
        blocked={
          noHost
            ? blockedMessage("Connect GitHub or Bitbucket to list pull requests.")
            : list === null && error !== null
              ? requestFailed(false)
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
        onOpen={onOpen}
      />
    </div>
  );
};
