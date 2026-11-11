import { type ReactNode, useId } from "react";
import type { HostKind, PullRequestSummary } from "../../../../src/domain/review/index.ts";
import { Skeleton } from "../../ui/skeleton.tsx";
import { relativeTime } from "./relative-time.ts";

export const HOST_NAMES: Readonly<Record<HostKind, string>> = {
  github: "GitHub",
  bitbucket: "Bitbucket",
};

const SKELETON_ROWS = 3;

export const PullRequestList = ({
  title,
  action,
  empty,
  items,
  nowMs,
  startingUrl,
  onOpen,
}: {
  readonly title: string;
  /** Shown beside the title. */
  readonly action?: ReactNode;
  readonly empty: string;
  /** null while loading. */
  readonly items: readonly PullRequestSummary[] | null;
  readonly nowMs: number;
  /** The PR whose analysis is starting. */
  readonly startingUrl: string | null;
  readonly onOpen: (url: string) => void;
}) => {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-2">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <h2 id={id} className="text-heading font-semibold">
          {title}
        </h2>
        {action}
      </div>
      {items === null ? (
        <ul
          className="flex flex-col gap-2 rounded-lg border p-3"
          aria-busy="true"
          aria-label={`Loading ${title.toLowerCase()}`}
        >
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have nothing else.
            <li key={index}>
              <Skeleton className="h-10 w-full" />
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-6 text-center text-muted-foreground">
          {empty}
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {items.map((item) => {
            const { repo, number } = item.ref;
            return (
              <li key={item.url}>
                <button
                  type="button"
                  className="grid w-full grid-cols-[auto_1fr_auto] items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-left hover:bg-accent focus-visible:-outline-offset-2 aria-busy:bg-accent"
                  data-pr-row=""
                  aria-busy={startingUrl === item.url}
                  onClick={() => onOpen(item.url)}
                >
                  <span className="text-caption text-muted-foreground">
                    {HOST_NAMES[repo.host]}
                  </span>
                  <span className="min-w-0 truncate font-mono text-code-compact text-muted-foreground">
                    {repo.owner}/{repo.repo} #{number}
                  </span>
                  <span className="col-span-2 col-start-1 row-start-2 min-w-0 truncate font-medium">
                    {item.title}
                  </span>
                  <span className="col-start-3 row-span-2 row-start-1 self-center text-caption whitespace-nowrap text-muted-foreground">
                    {startingUrl === item.url ? (
                      "Starting…"
                    ) : (
                      <>
                        {item.author.name} ·{" "}
                        <time dateTime={item.updatedAt}>{relativeTime(item.updatedAt, nowMs)}</time>
                      </>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
