import { memo, useId } from "react";
import type {
  Decision,
  DecisionCategory,
  DecisionId,
  Verdict,
} from "../../../../src/domain/review/index.ts";
import { VERDICT_STATUS } from "../../lib/status.ts";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../ui/button.tsx";
import { StatusBadge } from "../../ui/status-badge.tsx";
import { Textarea } from "../../ui/textarea.tsx";
import type { Draft, SaveStatus } from "./useVerdicts.ts";

// Spelled out because Tailwind only generates the classes it finds whole in the source.
const BORDER: Readonly<Record<Verdict, string>> = {
  pending: "border-l-thread-marker",
  approved: "border-l-review-approved",
  rejected: "border-l-review-changes",
};

export const CATEGORY_NAMES: Readonly<Record<DecisionCategory, string>> = {
  api: "API",
  data: "Data",
  dependency: "Dependency",
  security: "Security",
  "error-handling": "Error handling",
  performance: "Performance",
  concurrency: "Concurrency",
  configuration: "Configuration",
  behavior: "Behavior",
  other: "Other",
};

const STATUS_TEXT: Readonly<Record<SaveStatus, string>> = {
  waiting: "",
  saving: "Saving…",
  saved: "Saved",
  failed: "Not saved",
};

export const decisionAnchor = (id: DecisionId): string => `decision-${id}`;

/**
 * A decision the code makes, next to the code it rests on: approve, reject or comment. Focusing
 * anything in it selects it, for the `a`, `r` and `c` shortcuts.
 */
export const DecisionCard = memo(function DecisionCard({
  decision,
  draft,
  status,
  selected,
  readOnly,
  commentRef,
  onSelect,
  onVerdict,
  onComment,
}: {
  readonly decision: Decision;
  readonly draft: Draft;
  readonly status: SaveStatus | null;
  readonly selected: boolean;
  /** After publishing, and before the analysis is complete, verdicts and comments can't change. */
  readonly readOnly: boolean;
  /** Receives the selected decision's comment field, for the `c` shortcut. */
  readonly commentRef: (field: HTMLTextAreaElement | null) => void;
  readonly onSelect: (id: DecisionId) => void;
  readonly onVerdict: (id: DecisionId, verdict: Verdict) => void;
  readonly onComment: (id: DecisionId, comment: string) => void;
}) {
  const id = useId();
  const toggle = (verdict: Verdict) =>
    onVerdict(decision.id, draft.verdict === verdict ? "pending" : verdict);
  return (
    <article
      id={decisionAnchor(decision.id)}
      data-slot="decision"
      data-verdict={draft.verdict}
      data-selected={selected || undefined}
      className={cn(
        "flex scroll-mt-24 flex-col gap-2 rounded-lg border border-l-3 bg-thread-bg p-3 -outline-offset-2",
        BORDER[draft.verdict],
        selected && "shadow-[inset_0_0_0_2px_var(--ring)]",
      )}
      aria-labelledby={`${id}-title`}
      tabIndex={-1}
      onFocus={() => onSelect(decision.id)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border bg-muted px-2 text-caption font-medium text-muted-foreground">
          {CATEGORY_NAMES[decision.category]}
        </span>
        <h3 id={`${id}-title`} className="min-w-0 font-semibold whitespace-pre-line">
          {decision.title}
        </h3>
        {draft.verdict !== "pending" && (
          <StatusBadge status={VERDICT_STATUS[draft.verdict]} className="ml-auto" />
        )}
      </div>
      <p className="text-body whitespace-pre-line text-muted-foreground">{decision.whyItMatters}</p>
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            aria-pressed={draft.verdict === "approved"}
            aria-label={`Approve: ${decision.title}`}
            disabled={readOnly}
            onClick={() => toggle("approved")}
            className="aria-pressed:border-review-approved aria-pressed:bg-review-approved-bg aria-pressed:text-review-approved"
          >
            <span aria-hidden="true">✓</span> Approve
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={draft.verdict === "rejected"}
            aria-label={`Reject: ${decision.title}`}
            disabled={readOnly}
            onClick={() => toggle("rejected")}
            className="aria-pressed:border-review-changes aria-pressed:bg-review-changes-bg aria-pressed:text-review-changes"
          >
            <span aria-hidden="true">✕</span> Reject
          </Button>
        </div>
        <label className="sr-only" htmlFor={`${id}-comment`}>
          Comment on: {decision.title}
        </label>
        <Textarea
          id={`${id}-comment`}
          ref={selected ? commentRef : undefined}
          className="min-h-7 min-w-48 flex-1 py-1 read-only:border-dashed"
          rows={1}
          placeholder={readOnly ? "" : "Comment (optional)"}
          value={draft.comment}
          readOnly={readOnly}
          onChange={(event) => onComment(decision.id, event.target.value)}
        />
        {status !== null && STATUS_TEXT[status] !== "" && (
          <span
            className={cn(
              "self-center text-caption",
              status === "failed" ? "text-destructive" : "text-muted-foreground",
            )}
            role="status"
          >
            {STATUS_TEXT[status]}
          </span>
        )}
      </div>
    </article>
  );
});

/** On another hunk a decision rests on: one line back to its card. */
export const DecisionMention = ({
  decision,
  onGo,
}: {
  readonly decision: Decision;
  readonly onGo: (id: DecisionId) => void;
}) => (
  <p data-slot="decision-mention" className="text-muted-foreground">
    Decision:{" "}
    <button
      type="button"
      className="min-h-6 rounded-sm text-left whitespace-pre-line text-primary underline-offset-2 hover:underline"
      onClick={() => onGo(decision.id)}
    >
      {decision.title}
    </button>
  </p>
);
