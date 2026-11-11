import { Fragment, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
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
import { CommentCard } from "./comment-card.tsx";
import { absoluteTime, initialsOf, relativeTime } from "./people.ts";
import { SuggestionDiff } from "./suggestion-diff.tsx";
import { ThreadBody } from "./thread-body.tsx";

/** A severity's glyph and color, for its chip. */
const SEVERITY_MARK: Readonly<
  Record<Severity, { readonly glyph: string; readonly color: string }>
> = {
  blocking: { glyph: "■", color: "text-severity-blocker" },
  major: { glyph: "▲", color: "text-severity-major" },
  minor: { glyph: "●", color: "text-severity-minor" },
};

const SEVERITY_CHIP: Readonly<Record<Severity, string>> = {
  blocking: "bg-review-changes-bg border-severity-blocker/25",
  major: "bg-severity-major-bg border-severity-major/25",
  minor: "bg-review-pending-bg border-severity-minor/25",
};

export const CHIP =
  "inline-flex items-center gap-1 rounded-sm border px-1.5 text-caption font-medium";

export const SeverityChip = ({ severity }: { readonly severity: Severity }) => (
  <span
    data-slot="severity"
    className={cn(CHIP, SEVERITY_MARK[severity].color, SEVERITY_CHIP[severity])}
  >
    <span aria-hidden="true">{SEVERITY_MARK[severity].glyph}</span>
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
  /** Where an image or video pasted into a comment loads from; without it, they're named. */
  readonly mediaUrl?: (url: string) => string;
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

/** Consecutive comments by one person, read under one header. */
const groupByAuthor = (
  comments: readonly ThreadComment[],
): readonly (readonly ThreadComment[])[] => {
  const groups: ThreadComment[][] = [];
  for (const comment of comments) {
    const last = groups.at(-1);
    if (last !== undefined && last[0]?.author.id === comment.author.id) last.push(comment);
    else groups.push([comment]);
  }
  return groups;
};

/**
 * A review thread from the host: its comments grouped by person, with their severities and
 * suggested changes, and one row of actions: Reply (`r`), which opens the field in its place, a
 * lone suggestion's Apply and Add to batch (`b`), and Resolve (`e`). A resolved thread folds to one
 * line.
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
  mediaUrl,
  initialReply,
  className,
}: ReviewThreadProps) => {
  const [open, setOpen] = useState(!thread.resolved);
  const [composing, setComposing] = useState(initialReply !== undefined);
  const [focusAsked, setFocusAsked] = useState(0);
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
  const canReply = onReply !== undefined && thread.can.reply;
  const canResolve = onResolve !== undefined && thread.can.resolve;
  // The field stays while there's something in it to lose: text, a post on its way, or a failure.
  const fieldShown = canReply && (composing || reply !== "" || posting || replyError !== null);

  const openField = () => {
    setOpen(true);
    setComposing(true);
    setFocusAsked((asked) => asked + 1);
  };

  useEffect(() => {
    if (focusAsked > 0) field.current?.focus();
  }, [focusAsked]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: opens when asked to, not on each render.
  useEffect(() => {
    if (replying) openField();
  }, [replying]);

  /** Back to the thread, so r, e and b work again once the field is gone. */
  const focusThread = () =>
    field.current?.closest<HTMLElement>("[data-slot=review-thread]")?.focus();

  const cancel = () => {
    if (posting) return;
    focusThread();
    setReply("");
    setReplyError(null);
    setComposing(false);
  };

  const send = async () => {
    const body = reply.trim();
    if (body === "" || posting || onReply === undefined) return;
    const article = field.current?.closest<HTMLElement>("[data-slot=review-thread]");
    setPosting(true);
    setReplyError(null);
    const error = await onReply(body);
    setPosting(false);
    // The text stays after a failure: whether to send it again is the reviewer's call.
    if (error !== null) {
      setReplyError(error);
      return;
    }
    setReply("");
    setComposing(false);
    article?.focus();
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

  const suggesting = thread.comments.filter((comment) => suggestionOf(comment.body) !== null);
  const [firstSuggestion] = suggesting;
  // A lone suggestion's buttons join the thread's row; several keep theirs under each.
  const lone = suggesting.length === 1 && applicable ? firstSuggestion : undefined;

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const id = shortcutFor(event, ["replyThread", "resolveThread", "addToBatch"], {
      mac: isMac(),
      singleKeys,
    });
    if (id === null) return;
    if (id === "replyThread" && canReply) {
      openField();
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

  const suggestionButtons = (comment: ThreadComment) => {
    const inBatch = batch.has(comment.id);
    const problem = batch.problem(comment.id);
    return (
      <>
        <Button variant="outline" size="sm" onClick={() => onApply?.(comment.id)}>
          Apply suggestion
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-pressed={inBatch}
          disabled={!inBatch && problem !== null}
          onClick={() => (inBatch ? onRemoveFromBatch?.(comment.id) : onAddToBatch?.(comment.id))}
        >
          {inBatch ? "✓ In batch" : "Add to batch"}
          <KeyHint id="addToBatch" />
        </Button>
        {problem !== null && !inBatch && (
          <span className="text-caption text-muted-foreground">{problem}</span>
        )}
      </>
    );
  };

  const suggestionView = (comment: ThreadComment) => (lines: readonly string[]) => {
    const own = suggestionOf(comment.body) !== null;
    return (
      <div className="flex flex-col gap-1.5">
        <SuggestionDiff
          title="Suggested change"
          removed={current ? covered : null}
          added={lines}
          language={language}
        />
        {own && applicable && lone === undefined && (
          <div className="flex flex-wrap items-center gap-2">{suggestionButtons(comment)}</div>
        )}
      </div>
    );
  };

  const groupView = (group: readonly ThreadComment[]) => {
    const [head] = group;
    if (head === undefined) return null;
    return (
      <section data-slot="thread-group" className="flex flex-col gap-2">
        <header className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Initials name={head.author.name} />
          <span className="font-medium">{head.author.name}</span>
          {authorId !== null && head.author.id === authorId && (
            <span className={cn(CHIP, "border-border bg-muted text-muted-foreground")}>Author</span>
          )}
          <time
            dateTime={head.createdAt}
            title={absoluteTime(head.createdAt)}
            className="text-caption text-muted-foreground"
          >
            {relativeTime(head.createdAt, now)}
          </time>
        </header>
        {group.map((comment) => {
          const { severity, blocks } = parseBody(comment.body);
          return (
            <div
              key={comment.id}
              data-slot="thread-comment"
              className="flex flex-col items-start gap-1.5"
            >
              {severity !== null && <SeverityChip severity={severity} />}
              <div className="w-full">
                <ThreadBody
                  blocks={blocks}
                  suggestion={suggestionView(comment)}
                  {...(mediaUrl === undefined ? {} : { mediaUrl })}
                />
              </div>
            </div>
          );
        })}
      </section>
    );
  };

  const [first] = thread.comments;
  const resolvedBy = thread.resolvedBy?.name;
  const hasActions = canReply || canResolve || lone !== undefined;
  return (
    <CommentCard
      as="article"
      state={state}
      data-slot="review-thread"
      aria-label={`Thread on ${threadPlace(thread)}${thread.resolved ? ", resolved" : ""}`}
      onKeyDown={onKeyDown}
      // The thread takes the focus for r, e and b.
      tabIndex={0}
      className={cn("flex flex-col gap-3 -outline-offset-2", !open && "py-1.5", className)}
    >
      {!open ? (
        <div className="flex min-h-7 flex-wrap items-center gap-2">
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
            <div className="flex flex-wrap items-center gap-2 text-caption">
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
          {groupByAuthor(thread.comments).map((group, at) => (
            <Fragment key={group[0]?.id ?? at}>
              {at > 0 && <hr data-slot="thread-divider" />}
              {groupView(group)}
            </Fragment>
          ))}
          {resolveError !== null && (
            <p role="alert" className="text-caption text-destructive">
              ✕ {thread.resolved ? "Not reopened" : "Not resolved"}: {resolveError}
            </p>
          )}
          {fieldShown ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={fieldId} className="sr-only">
                Reply to the thread on {threadPlace(thread)}
              </label>
              <Textarea
                id={fieldId}
                ref={field}
                rows={2}
                value={reply}
                placeholder="Reply…"
                disabled={posting}
                aria-invalid={replyError !== null || undefined}
                onChange={(event) => setReply(event.target.value)}
                onSubmitShortcut={() => void send()}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    cancel();
                  }
                }}
                className="min-h-14 bg-background"
              />
              {replyError !== null && (
                <p role="alert" className="text-caption text-destructive">
                  ✕ Not sent: {replyError} Your reply is still here; send it again when you're
                  ready.
                </p>
              )}
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button variant="ghost" size="sm" disabled={posting} onClick={cancel}>
                  Cancel
                  <KeyHint id="close" />
                </Button>
                <Button
                  size="sm"
                  disabled={reply.trim() === "" || posting}
                  onClick={() => void send()}
                >
                  {posting ? "Sending…" : "Reply"}
                  <KeyHint id="submit" />
                </Button>
              </div>
            </div>
          ) : (
            hasActions && (
              <div data-slot="thread-actions" className="flex flex-wrap items-center gap-2">
                {canReply && (
                  <Button variant="outline" size="sm" onClick={openField}>
                    Reply
                    <KeyHint id="replyThread" />
                  </Button>
                )}
                {lone !== undefined && suggestionButtons(lone)}
                {canResolve && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={resolving}
                    onClick={() => void toggleResolved()}
                  >
                    {thread.resolved ? "Reopen" : "Resolve"}
                    <KeyHint id="resolveThread" />
                  </Button>
                )}
              </div>
            )
          )}
        </>
      )}
    </CommentCard>
  );
};
