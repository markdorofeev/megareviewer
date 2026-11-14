import { ChevronRightIcon, LoaderCircleIcon, type LucideIcon } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react";
import type { HostKind, PullRequestSummary } from "../../../../src/domain/review/index.ts";
import { cn } from "../../lib/utils.ts";
import { initialsOf, KeyHint } from "../../review/index.ts";
import { Badge } from "../../ui/badge.tsx";
import { Skeleton } from "../../ui/skeleton.tsx";
import { fullDate, relativeTime } from "./relative-time.ts";

export const HOST_NAMES: Readonly<Record<HostKind, string>> = {
  github: "GitHub",
  bitbucket: "Bitbucket",
};

export const prLabel = ({ repo, number }: PullRequestSummary["ref"]): string =>
  `${repo.owner}/${repo.repo} #${number}`;

// Spelled out because Tailwind only generates the classes it finds whole in the source.
const AVATARS = [
  "bg-avatar-1-bg text-avatar-1-fg",
  "bg-avatar-2-bg text-avatar-2-fg",
  "bg-avatar-3-bg text-avatar-3-fg",
  "bg-avatar-4-bg text-avatar-4-fg",
  "bg-avatar-5-bg text-avatar-5-fg",
  "bg-avatar-6-bg text-avatar-6-fg",
  "bg-avatar-7-bg text-avatar-7-fg",
  "bg-avatar-8-bg text-avatar-8-fg",
] as const;

/** An author's colors, the same for them on every row: a hash of their host ID. */
export const avatarColors = (authorId: string): string => {
  let hash = 0;
  for (const char of authorId) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return AVATARS[hash % AVATARS.length] ?? AVATARS[0];
};

export const SPIN = "animate-spin motion-reduce:animate-[spin_3s_linear_infinite]";

/** A row's name, all it says in one sentence. */
export const rowName = (item: PullRequestSummary, nowMs: number): string => {
  const author = item.role === "author" ? "you" : item.author.name;
  return `${item.title}. ${prLabel(item.ref)} by ${author}, updated ${relativeTime(item.updatedAt, nowMs)}, ${HOST_NAMES[item.ref.repo.host]}`;
};

const Row = ({
  item,
  nowMs,
  starting,
  tabbable,
  onOpen,
  onFocus,
}: {
  readonly item: PullRequestSummary;
  readonly nowMs: number;
  readonly starting: boolean;
  readonly tabbable: boolean;
  readonly onOpen: () => void;
  readonly onFocus: () => void;
}) => {
  const host = HOST_NAMES[item.ref.repo.host];
  const author = item.role === "author" ? "you" : item.author.name;
  return (
    <li>
      <button
        type="button"
        data-pr-row=""
        tabIndex={tabbable ? 0 : -1}
        aria-label={rowName(item, nowMs)}
        aria-busy={starting}
        onClick={() => {
          if (!starting) onOpen();
        }}
        onFocus={onFocus}
        className="group flex min-h-[58px] w-full flex-col items-stretch gap-x-3 gap-y-1 px-4 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:-outline-offset-2 aria-busy:bg-diff-hunk-bg max-sm:items-start sm:flex-row sm:items-center"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1 self-stretch">
          <span className="truncate font-medium">{item.title}</span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-caption text-muted-foreground @min-[480px]:flex-nowrap">
            <span className="shrink-0 font-mono text-code-compact">{prLabel(item.ref)}</span>
            <span
              aria-hidden="true"
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium",
                avatarColors(item.author.id),
              )}
            >
              {initialsOf(item.author.name)}
            </span>
            <span className="max-w-48 min-w-0 truncate">{author}</span>
            <time dateTime={item.updatedAt} title={fullDate(item.updatedAt)} className="shrink-0">
              {relativeTime(item.updatedAt, nowMs)}
            </time>
            <Badge variant="outline" className="ml-auto text-muted-foreground @min-[480px]:hidden">
              {host}
            </Badge>
          </span>
        </span>
        {starting ? (
          <span className="flex shrink-0 items-center gap-2 text-caption">
            <LoaderCircleIcon aria-hidden="true" className={cn("size-4 text-diff-hunk-fg", SPIN)} />
            <span className="font-medium text-diff-hunk-fg">Opening review…</span>
            <span className="text-muted-foreground">Esc to cancel</span>
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-2">
            <Badge variant="outline" className="text-muted-foreground @max-[479px]:hidden">
              {host}
            </Badge>
            <KeyHint id="openRow" className="hidden group-focus-visible:inline-flex" />
            <ChevronRightIcon
              aria-hidden="true"
              className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 max-sm:hidden"
            />
          </span>
        )}
      </button>
    </li>
  );
};

export interface EmptyState {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly text: string;
}

const MOVES: Readonly<Record<string, (index: number, last: number) => number>> = {
  ArrowDown: (index, last) => Math.min(last, index + 1),
  ArrowUp: (index) => Math.max(0, index - 1),
  Home: () => 0,
  End: (_, last) => last,
};

/**
 * A card of PRs with its header and states. The list is one Tab stop: the arrows, Home and End
 * move inside it, never into the other list.
 */
export const PullRequestList = ({
  title,
  word,
  items,
  count,
  loading,
  skeletonRows,
  notes,
  blocked,
  empty,
  nowMs,
  startingUrl,
  onOpen,
}: {
  readonly title: string;
  /** Muted, after the count: "Waiting for your review", "Open", "GitHub only". */
  readonly word: string;
  /** null before the first read. */
  readonly items: readonly PullRequestSummary[] | null;
  /** Shown in the pill; null hides it. */
  readonly count: number | "…" | null;
  /** What the first read says while it runs, under the skeleton's spinner. */
  readonly loading: string;
  readonly skeletonRows: number;
  /** Alerts and notes above the rows. */
  readonly notes?: ReactNode;
  /** In place of the rows and the empty state, when nothing can be listed. */
  readonly blocked?: ReactNode;
  readonly empty: EmptyState;
  readonly nowMs: number;
  readonly startingUrl: string | null;
  readonly onOpen: (item: PullRequestSummary) => void;
}) => {
  const id = useId();
  const list = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(0);
  const rows = items ?? [];
  const tabbable = Math.min(active, Math.max(0, rows.length - 1));

  const move = (event: KeyboardEvent<HTMLUListElement>) => {
    const step = MOVES[event.key];
    const buttons = [...(list.current?.querySelectorAll<HTMLElement>("[data-pr-row]") ?? [])];
    const index = event.target instanceof HTMLElement ? buttons.indexOf(event.target) : -1;
    if (step === undefined || index === -1) return;
    event.preventDefault();
    const next = step(index, buttons.length - 1);
    setActive(next);
    buttons[next]?.focus();
  };

  const EmptyIcon = empty.icon;
  return (
    <section
      aria-labelledby={id}
      className="@container flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card"
    >
      <div className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-2">
        <h2 id={id} className="text-heading font-semibold">
          {title}
        </h2>
        {count !== null && (
          <span className="rounded-full bg-muted px-2 text-caption font-medium text-muted-foreground tabular-nums">
            <span aria-hidden="true">{count}</span>
            <span className="sr-only">
              {count === "…" ? "Loading" : `${count} pull request${count === 1 ? "" : "s"}`}
            </span>
          </span>
        )}
        <span className="text-caption text-muted-foreground">{word}</span>
      </div>
      <div className="flex flex-col gap-2 p-3 empty:hidden">{notes}</div>
      {blocked ??
        (items === null ? (
          <div aria-busy="true" className="flex flex-col">
            <p className="flex items-center gap-2 px-4 pt-3 text-caption text-muted-foreground">
              <LoaderCircleIcon aria-hidden="true" className={cn("size-4", SPIN)} />
              {loading}
            </p>
            <ul aria-hidden="true" className="flex flex-col gap-3 px-4 py-3">
              {Array.from({ length: skeletonRows }, (_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have nothing else.
                <li key={index} className="flex flex-col gap-1.5">
                  <Skeleton className="h-4 w-3/4 motion-reduce:animate-none" />
                  <Skeleton className="h-3 w-1/2 motion-reduce:animate-none" />
                </li>
              ))}
            </ul>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-6 py-8 text-center">
            <EmptyIcon aria-hidden="true" className="mb-1 size-6 text-muted-foreground" />
            <p className="font-medium">{empty.title}</p>
            <p className="max-w-sm text-caption text-muted-foreground">{empty.text}</p>
          </div>
        ) : (
          <ul ref={list} className="divide-y" onKeyDown={move}>
            {rows.map((item, index) => (
              <Row
                key={item.url}
                item={item}
                nowMs={nowMs}
                starting={startingUrl === item.url}
                tabbable={index === tabbable}
                onOpen={() => onOpen(item)}
                onFocus={() => setActive(index)}
              />
            ))}
          </ul>
        ))}
    </section>
  );
};
