import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import {
  parseBody,
  type ReviewThread,
  type Severity,
  splitSeverity,
  suggestionOf,
  type ThreadComment,
} from "../../../../src/domain/review/index.ts";
import { isMac, shortcutFor, useSingleKeyShortcuts } from "../../lib/keymap.ts";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../ui/button.tsx";
import { Textarea } from "../../ui/textarea.tsx";
import { KeyHint } from "../shell/key-hint.tsx";
import { initialsOf, relativeTime } from "./people.ts";
import { SuggestionDiff } from "./suggestion-diff.tsx";
import { ThreadBody } from "./thread-body.tsx";

const SEVERITY: Readonly<Record<Severity, { readonly glyph: string; readonly className: string }>> =
  {
    blocking: {
      glyph: "■",
      className: "text-severity-blocker bg-review-changes-bg border-severity-blocker/25",
    },
    major: {
      glyph: "▲",
      className: "text-severity-major bg-severity-major-bg border-severity-major/25",
    },
    minor: {
      glyph: "●",
      className: "text-severity-minor bg-review-pending-bg border-severity-minor/25",
    },
  };

const CHIP = "inline-flex items-center gap-1 rounded-sm border px-1.5 text-caption font-medium";

export const SeverityChip = ({ severity }: { readonly severity: Severity }) => (
  <span data-slot="severity" className={cn(CHIP, SEVERITY[severity].className)}>
    <span aria-hidden="true">{SEVERITY[severity].glyph}</span>
    {severity}
  </span>
);

/** What the thread does with a suggestion in the batch, and why it can't go in, if it can't. */
export interface BatchState {
  readonly has: (commentId: string) => boolean;
  /** Why the suggestion can't join the batch, e.g. it overlaps one already there; else null. */
  readonly problem: (commentId: string) => string | null;
}

export interface ReviewThreadProps {
  readonly thread: ReviewThread;
  /** The PR's author, whose comments carry an Author chip. */
  readonly authorId: string | null;
  /** The time "5 min ago" is counted from. */
  readonly now: number;
  /** The file's grammar, for coloring suggestions. */
  readonly language: string | null;
  /** The lines the thread covers at the head, which a suggestion replaces; null when unknown. */
  readonly covered: readonly string[] | null;
  /** The reviewer may push to the PR's branch, so suggestions can be applied. */
  readonly canApply: boolean;
  readonly batch: BatchState;
  /** Posts a reply; resolves to an error message, or null once it's posted. */
  readonly onReply?: (body: string) => Promise<string | null>;
  /** Resolves or reopens; resolves to an error message, or null once it's done. */
  readonly onResolve?: (resolved: boolean) => Promise<string | null>;
  readonly onAddToBatch?: (commentId: string) => void;
  readonly onRemoveFromBatch?: (commentId: string) => void;
  /** Applies this one suggestion on its own. */
  readonly onApply?: (commentId: string) => void;
  /** Open with the reply field focused. */
  readonly replying?: boolean;
  /** A reply already in the field, posting or failed: for showing those states on made-up data. */
  readonly initialReply?: {
    readonly text: string;
    readonly status: "posting" | "failed";
    readonly error?: string;
  };
  readonly className?: string;
}

const Initials = ({ name }: { readonly name: string }) => (
  <span
    aria-hidden="true"
    className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-caption font-medium text-muted-foreground"
  >
    {initialsOf(name)}
  </span>
);

/** Where a thread is: its lines in the file, for screen readers and the "Earlier comments" list. */
export const threadPlace = (thread: ReviewThread): string => {
  const line = thread.line ?? thread.originalLine;
  if (line === null) return thread.path;
  const old = thread.side === "old" ? "old " : "";
  return thread.startLine !== null && thread.line !== null
    ? `${old}lines ${thread.startLine}–${line}`
    : `${old}line ${line}`;
};

/**
 * A review thread from the host: its comments with their authors, severities and suggested
 * changes, a reply field (`r`) and Resolve (`e`). A resolved thread folds to one line.
 */
export const ReviewThreadView = ({
  thread,
  authorId,
  now,
  language,
  covered,
  canApply,
  batch,
  onReply,
  onResolve,
  onAddToBatch,
  onRemoveFromBatch,
  onApply,
  replying = false,
  initialReply,
  className,
}: ReviewThreadProps) => {
  const [open, setOpen] = useState(!thread.resolved);
  const [reply, setReply] = useState(initialReply?.text ?? "");
  const [posting, setPosting] = useState(initialReply?.status === "posting");
  const [replyError, setReplyError] = useState<string | null>(
    initialReply?.status === "failed" ? (initialReply.error ?? "") : null,
  );
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();
  const [singleKeys] = useSingleKeyShortcuts();
  const state = thread.resolved ? "resolved" : thread.outdated ? "outdated" : "open";
  const current = !thread.outdated && thread.line !== null && thread.side === "new";
  const applicable = canApply && current;

  useEffect(() => {
    if (replying) {
      setOpen(true);
      field.current?.focus();
    }
  }, [replying]);

  const send = async () => {
    const body = reply.trim();
    if (body === "" || posting || onReply === undefined) return;
    setPosting(true);
    setReplyError(null);
    const error = await onReply(body);
    setPosting(false);
    // The text stays after a failure: whether to send it again is the reviewer's call.
    if (error === null) setReply("");
    else setReplyError(error);
  };

  const toggleResolved = async () => {
    if (onResolve === undefined || resolving) return;
    setResolving(true);
    setResolveError(null);
    const error = await onResolve(!thread.resolved);
    setResolving(false);
    if (error !== null) setResolveError(error);
    else setOpen(thread.resolved);
  };

  const firstSuggestion = thread.comments.find((comment) => suggestionOf(comment.body) !== null);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const id = shortcutFor(event, ["replyThread", "resolveThread", "addToBatch"], {
      mac: isMac(),
      singleKeys,
    });
    if (id === null) return;
    if (id === "replyThread" && onReply !== undefined && thread.can.reply) {
      // A folded thread draws its field first.
      if (field.current === null) {
        setOpen(true);
        requestAnimationFrame(() => field.current?.focus());
      } else {
        field.current.focus();
      }
    } else if (id === "resolveThread" && thread.can.resolve) {
      void toggleResolved();
    } else if (
      id === "addToBatch" &&
      firstSuggestion !== undefined &&
      applicable &&
      batch.problem(firstSuggestion.id) === null
    ) {
      if (batch.has(firstSuggestion.id)) onRemoveFromBatch?.(firstSuggestion.id);
      else onAddToBatch?.(firstSuggestion.id);
    } else {
      return;
    }
    // Handled here, so the page's own r (reject a decision) doesn't run too.
    event.preventDefault();
  };

  const suggestionView = (comment: ThreadComment) => (lines: readonly string[]) => {
    const own = suggestionOf(comment.body) !== null;
    const inBatch = batch.has(comment.id);
    const problem = batch.problem(comment.id);
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-muted-foreground">Suggested change</span>
        <SuggestionDiff removed={current ? covered : null} added={lines} language={language} />
        {own && applicable && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              aria-pressed={inBatch}
              disabled={!inBatch && problem !== null}
              onClick={() =>
                inBatch ? onRemoveFromBatch?.(comment.id) : onAddToBatch?.(comment.id)
              }
            >
              {inBatch ? "✓ In batch" : "Add to batch"}
              <KeyHint id="addToBatch" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => onApply?.(comment.id)}>
              Apply suggestion
            </Button>
            {problem !== null && !inBatch && (
              <span className="text-caption text-muted-foreground">{problem}</span>
            )}
          </div>
        )}
      </div>
    );
  };

  const commentView = (comment: ThreadComment) => {
    const { severity, blocks } = parseBody(comment.body);
    return (
      <div key={comment.id} data-slot="thread-comment" className="flex gap-2.5 py-2">
        <Initials name={comment.author.name} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <header className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-medium">{comment.author.name}</span>
            {authorId !== null && comment.author.id === authorId && (
              <span className={cn(CHIP, "border-border bg-muted text-muted-foreground")}>
                Author
              </span>
            )}
            <time dateTime={comment.createdAt} className="text-caption text-muted-foreground">
              {relativeTime(comment.createdAt, now)}
            </time>
            {severity !== null && <SeverityChip severity={severity} />}
          </header>
          <ThreadBody blocks={blocks} suggestion={suggestionView(comment)} />
        </div>
      </div>
    );
  };

  const [first, ...replies] = thread.comments;
  const resolvedBy = thread.resolvedBy?.name;
  return (
    <article
      data-slot="review-thread"
      data-state={state}
      aria-label={`Thread on ${threadPlace(thread)}${thread.resolved ? ", resolved" : ""}`}
      onKeyDown={onKeyDown}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the thread takes the focus for r, e and b.
      tabIndex={0}
      className={cn(
        "rounded-md border border-l-3 bg-thread-bg px-3 font-sans -outline-offset-2",
        state === "open" && "border-l-thread-marker",
        state === "resolved" && "border-l-review-approved",
        state === "outdated" && "border-l-muted-foreground",
        className,
      )}
    >
      {!open ? (
        <div className="flex min-h-9 flex-wrap items-center gap-2 py-1">
          <span className="text-caption text-review-approved">
            <span aria-hidden="true">✓ </span>
            Resolved{resolvedBy === undefined ? "" : ` by ${resolvedBy}`}
          </span>
          {first !== undefined && (
            <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground">
              {first.author.name}: {splitSeverity(first.body).rest.split("\n")[0]}
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-expanded={false}>
            Show {thread.comments.length} {thread.comments.length === 1 ? "comment" : "comments"}
          </Button>
        </div>
      ) : (
        <>
          {(thread.outdated || thread.resolved) && (
            <div className="flex flex-wrap items-center gap-2 pt-2 text-caption">
              {thread.outdated && (
                <span className={cn(CHIP, "border-border bg-muted text-muted-foreground")}>
                  Outdated
                </span>
              )}
              {thread.resolved && (
                <>
                  <span className="text-review-approved">
                    <span aria-hidden="true">✓ </span>
                    Resolved{resolvedBy === undefined ? "" : ` by ${resolvedBy}`}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => setOpen(false)} aria-expanded>
                    Hide
                  </Button>
                </>
              )}
            </div>
          )}
          {first !== undefined && commentView(first)}
          {replies.length > 0 && (
            <div data-slot="thread-replies" className="border-t">
              {replies.map(commentView)}
            </div>
          )}
          {(onReply !== undefined || onResolve !== undefined) && (
            <div className="flex flex-col gap-1.5 border-t py-2">
              {onReply !== undefined && thread.can.reply && (
                <>
                  <label htmlFor={fieldId} className="sr-only">
                    Reply to the thread on {threadPlace(thread)}
                  </label>
                  <Textarea
                    id={fieldId}
                    ref={field}
                    rows={1}
                    value={reply}
                    placeholder="Reply…"
                    disabled={posting}
                    aria-invalid={replyError !== null || undefined}
                    onChange={(event) => setReply(event.target.value)}
                    onSubmitShortcut={() => void send()}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.stopPropagation();
                        field.current?.blur();
                      }
                    }}
                    className="min-h-9 bg-background"
                  />
                </>
              )}
              {replyError !== null && (
                <p role="alert" className="text-caption text-destructive">
                  ✕ Not sent: {replyError} Your reply is still here; send it again when you're
                  ready.
                </p>
              )}
              {resolveError !== null && (
                <p role="alert" className="text-caption text-destructive">
                  ✕ {thread.resolved ? "Not reopened" : "Not resolved"}: {resolveError}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-end gap-2">
                {onResolve !== undefined && thread.can.resolve && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={resolving}
                    onClick={() => void toggleResolved()}
                  >
                    {thread.resolved ? "Reopen" : "Resolve"}
                    <KeyHint id="resolveThread" />
                  </Button>
                )}
                {onReply !== undefined && thread.can.reply && (
                  <Button
                    size="sm"
                    disabled={reply.trim() === "" || posting}
                    onClick={() => void send()}
                  >
                    {posting ? "Sending…" : "Reply"}
                    <KeyHint id="submit" />
                  </Button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </article>
  );
};
