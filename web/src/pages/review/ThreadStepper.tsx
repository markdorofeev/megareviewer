import { CheckIcon, MessageSquareIcon } from "lucide-react";
import { useRef } from "react";
import {
  previewOf,
  type ReviewThread,
  type ThreadId,
} from "../../../../src/domain/review/index.ts";
import { cn } from "../../lib/utils.ts";
import { threadPlace } from "../../review/index.ts";
import { Dialog } from "./Dialog.tsx";
import { STEPPER_TITLE, Stepper } from "./PointStepper.tsx";
import { Segmented } from "./Segmented.tsx";
import { stepThreads, type ThreadScope, threadSteps } from "./thread-steps.ts";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Its line in the file, "line 32", or "the file" for a comment on the whole file. An outdated
 * thread's is the line it was on, as its place on the page says.
 */
const lineOf = (thread: ReviewThread): string => {
  if ((thread.line ?? thread.originalLine) === null) return "the file";
  return threadPlace(thread.outdated ? { ...thread, line: null } : thread);
};

/** What the thread is about in a line: who started it and the first line they wrote. */
export const threadTitle = (thread: ReviewThread): string => {
  const [first] = thread.comments;
  if (first === undefined) return lineOf(thread);
  const preview = previewOf(first.body);
  return `${first.author.name}: ${preview === "" ? "Suggested change" : preview}`;
};

/** The steps' count before the first: "3 unresolved", "7 threads". */
export const threadCount = (scope: ThreadScope, count: number): string =>
  scope === "unresolved" ? `${count} unresolved` : plural(count, "thread", "threads");

/** The threads' chip beside Claude's: the steps, counted; null without threads. */
export const threadChip = (
  ordered: readonly ReviewThread[],
  scope: ThreadScope,
  resolvedHere: ReadonlySet<ThreadId>,
): { count: number; words: readonly [string, string]; label: string } | null => {
  if (ordered.length === 0) return null;
  const count = threadSteps(ordered, scope, resolvedHere).length;
  return scope === "unresolved"
    ? {
        count,
        words: ["unresolved", "unresolved"],
        label: plural(count, "unresolved thread", "unresolved threads"),
      }
    : { count, words: ["thread", "threads"], label: plural(count, "thread", "threads") };
};

const ThreadIcon = ({ resolved }: { readonly resolved: boolean }) =>
  resolved ? (
    <CheckIcon aria-hidden="true" className="size-3.5 shrink-0 text-review-approved" />
  ) : (
    <MessageSquareIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
  );

/**
 * Previous and Next through the PR's threads in the page's order, with the position that opens
 * the list and the current thread's opening words, which go back to it.
 */
export const ThreadStepper = ({
  ordered,
  scope,
  resolvedHere,
  current,
  onGo,
  onOpenList,
}: {
  /** Every thread, in the page's order. */
  readonly ordered: readonly ReviewThread[];
  readonly scope: ThreadScope;
  /** Threads resolved on this page, which stay steps. */
  readonly resolvedHere: ReadonlySet<ThreadId>;
  /** The thread last gone to. */
  readonly current: ThreadId | null;
  readonly onGo: (id: ThreadId) => void;
  readonly onOpenList: () => void;
}) => {
  const steps = threadSteps(ordered, scope, resolvedHere);
  const found = steps.findIndex((thread) => thread.id === current);
  const at = found === -1 ? null : found;
  const thread = at === null ? undefined : steps[at];
  const title = thread === undefined ? "" : threadTitle(thread);
  return (
    <Stepper
      slot="thread-stepper"
      noun="thread"
      total={steps.length}
      at={at}
      count={threadCount(scope, steps.length)}
      onStep={(direction) => {
        const to = stepThreads(ordered, steps, current, direction);
        if (to !== null) onGo(to);
      }}
      onOpenList={onOpenList}
      title={
        thread !== undefined && (
          <button
            type="button"
            data-slot="stepper-title"
            data-kind="thread"
            className={STEPPER_TITLE}
            title={`${thread.path}, ${lineOf(thread)}`}
            aria-label={`Go to thread: ${title}`}
            onClick={() => onGo(thread.id)}
          >
            <ThreadIcon resolved={thread.resolved} />
            <span className={cn("min-w-0 truncate", thread.resolved && "text-muted-foreground")}>
              {title}
            </span>
          </button>
        )
      }
      // "Thread 2 of 3, src/services/receipts.ts line 32: Lee Park: This retries…"
      status={
        thread === undefined || at === null
          ? ""
          : `Thread ${at + 1} of ${steps.length}, ${thread.path} ${lineOf(thread)}${
              thread.resolved ? ", resolved" : thread.outdated ? ", outdated" : ""
            }: ${title}`
      }
    />
  );
};

/**
 * Every thread on the PR in the page's order, under its file, a row each that goes to it, and
 * whether Previous and Next go round the unresolved ones or all of them.
 */
export const ThreadList = ({
  ordered,
  scope,
  onScope,
  onGo,
  onClose,
}: {
  readonly ordered: readonly ReviewThread[];
  readonly scope: ThreadScope;
  readonly onScope: (scope: ThreadScope) => void;
  readonly onGo: (id: ThreadId) => void;
  readonly onClose: () => void;
}) => {
  const unresolved = ordered.filter((thread) => !thread.resolved).length;
  const went = useRef(false);
  const byFile: { path: string; threads: ReviewThread[] }[] = [];
  for (const thread of ordered) {
    const last = byFile.at(-1);
    if (last?.path === thread.path) last.threads.push(thread);
    else byFile.push({ path: thread.path, threads: [thread] });
  }
  return (
    <Dialog
      title={`${plural(ordered.length, "thread", "threads")}, ${unresolved} unresolved`}
      onClose={onClose}
      // A row moves the focus to what it goes to; closing mustn't take it back to the stepper.
      returnFocus={() => !went.current}
      className="sm:max-w-2xl"
    >
      {unresolved > 0 && unresolved < ordered.length && (
        <div className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
          <span aria-hidden="true">Previous and Next go round</span>
          <Segmented
            legend="Previous and Next go round"
            options={[
              { value: "unresolved", label: `Unresolved (${unresolved})` },
              { value: "all", label: `All (${ordered.length})` },
            ]}
            value={scope}
            onChange={onScope}
          />
        </div>
      )}
      {/* The dialog is a grid: without min-w-0 the list grows to its longest line. */}
      <div className="flex min-w-0 flex-col gap-3">
        {byFile.map(({ path, threads }) => (
          <section key={threads[0]?.id ?? path} aria-label={path} className="flex flex-col gap-1">
            <h3 className="truncate px-2 font-mono text-code-compact text-muted-foreground">
              {path}
            </h3>
            <ul className="flex flex-col gap-1">
              {threads.map((thread) => (
                <li key={thread.id}>
                  <button
                    type="button"
                    data-slot="thread-row"
                    data-resolved={thread.resolved || undefined}
                    className="flex min-h-7 w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-accent"
                    onClick={() => {
                      went.current = true;
                      onGo(thread.id);
                    }}
                  >
                    <ThreadIcon resolved={thread.resolved} />
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate",
                        thread.resolved && "text-muted-foreground",
                      )}
                    >
                      {threadTitle(thread)}
                    </span>
                    {(thread.resolved || thread.outdated) && (
                      <span className="text-caption text-muted-foreground">
                        {thread.resolved ? "Resolved" : "Outdated"}
                      </span>
                    )}
                    <span className="shrink-0 text-caption text-muted-foreground">
                      {lineOf(thread)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
};
