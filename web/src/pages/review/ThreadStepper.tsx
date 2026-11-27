import { MessageSquareIcon } from "lucide-react";
import {
  previewOf,
  type ReviewThread,
  type ThreadId,
} from "../../../../src/domain/review/index.ts";
import { cn } from "../../lib/utils.ts";
import { threadPlace } from "../../review/index.ts";
import { Button } from "../../ui/button.tsx";
import { PopoverHeader, PopoverTitle } from "../../ui/popover.tsx";
import { STEPPER_TITLE, Stepper } from "./PointStepper.tsx";
import { stepThreads, threadSteps } from "./thread-steps.ts";

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

/** The threads' chip beside Claude's: the unresolved threads, counted; null without any. */
export const threadChip = (
  ordered: readonly ReviewThread[],
): { count: number; words: readonly [string, string]; label: string } | null => {
  const count = threadSteps(ordered).length;
  if (count === 0) return null;
  return {
    count,
    words: ["unresolved", "unresolved"],
    label: plural(count, "unresolved thread", "unresolved threads"),
  };
};

const ThreadIcon = () => (
  <MessageSquareIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
);

/**
/**
 * The pager through the PR's unresolved threads in the page's order: the current thread's opening
 * words, which go back to it, and the position, which opens the list.
 */
export const ThreadStepper = ({
  ordered,
  current,
  onGo,
}: {
  /** Every thread, in the page's order. */
  readonly ordered: readonly ReviewThread[];
  /** The thread last gone to. */
  readonly current: ThreadId | null;
  readonly onGo: (id: ThreadId) => void;
}) => {
  const steps = threadSteps(ordered);
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
      started={current !== null}
      icon={<ThreadIcon />}
      count={steps.length}
      countWords="unresolved"
      onStep={(direction) => {
        const to = stepThreads(ordered, steps, current, direction);
        if (to !== null) onGo(to);
      }}
      list={(close) => (
        <ThreadList
          ordered={ordered}
          current={current}
          onGo={(id) => {
            close();
            onGo(id);
          }}
        />
      )}
      title={
        thread !== undefined && (
          <Button
            variant="ghost"
            size="xs"
            data-slot="stepper-title"
            data-kind="thread"
            className={STEPPER_TITLE}
            title={`${thread.path}, ${lineOf(thread)}`}
            aria-label={`Go to thread: ${title}`}
            onClick={() => onGo(thread.id)}
          >
            <ThreadIcon />
            <span className="min-w-0 truncate text-ui">{title}</span>
          </Button>
        )
      }
      // "Thread 2 of 3, src/services/receipts.ts line 32: Lee Park: This retries…"
      status={
        thread === undefined || at === null
          ? ""
          : `Thread ${at + 1} of ${steps.length}, ${thread.path} ${lineOf(thread)}${
              thread.outdated ? ", outdated" : ""
            }: ${title}`
      }
    />
  );
};

/**
 * The PR's unresolved threads in the page's order, under their file, a row each that goes to it,
 * in the popover the pager's position opens.
 */
export const ThreadList = ({
  ordered,
  current,
  onGo,
}: {
  /** Every thread, in the page's order. */
  readonly ordered: readonly ReviewThread[];
  /** The thread the pager is on. */
  readonly current: ThreadId | null;
  readonly onGo: (id: ThreadId) => void;
}) => {
  const byFile: { path: string; threads: ReviewThread[] }[] = [];
  for (const thread of threadSteps(ordered)) {
    const last = byFile.at(-1);
    if (last?.path === thread.path) last.threads.push(thread);
    else byFile.push({ path: thread.path, threads: [thread] });
  }
  const count = byFile.reduce((sum, file) => sum + file.threads.length, 0);
  return (
    <>
      <PopoverHeader>
        <PopoverTitle>{plural(count, "unresolved thread", "unresolved threads")}</PopoverTitle>
      </PopoverHeader>
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
                    aria-current={thread.id === current ? "true" : undefined}
                    className={cn(
                      "flex min-h-7 w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-accent",
                      thread.id === current && "bg-muted font-medium",
                    )}
                    onClick={() => onGo(thread.id)}
                  >
                    <ThreadIcon />
                    <span className="min-w-0 flex-1 truncate">{threadTitle(thread)}</span>
                    {thread.outdated && (
                      <span className="text-caption text-muted-foreground">Outdated</span>
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
    </>
  );
};
