import { memo, useId } from "react";
import type {
  Decision,
  DecisionCategory,
  DecisionId,
  Verdict,
} from "../../../../src/domain/review/index.ts";
import type { Draft, SaveStatus } from "./useVerdicts.ts";

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
      className={`decision verdict-${draft.verdict}${selected ? " selected" : ""}`}
      aria-labelledby={`${id}-title`}
      tabIndex={-1}
      onFocus={() => onSelect(decision.id)}
    >
      <div className="decision-head">
        <span className="badge category">{CATEGORY_NAMES[decision.category]}</span>
        <h3 id={`${id}-title`} className="decision-title model-text">
          {decision.title}
        </h3>
      </div>
      <p className="decision-why model-text">{decision.whyItMatters}</p>
      <div className="decision-controls">
        <div className="verdict-buttons">
          <button
            type="button"
            className="button verdict approve"
            aria-pressed={draft.verdict === "approved"}
            aria-label={`Approve: ${decision.title}`}
            disabled={readOnly}
            onClick={() => toggle("approved")}
          >
            <span aria-hidden="true">✓</span> Approve
          </button>
          <button
            type="button"
            className="button verdict reject"
            aria-pressed={draft.verdict === "rejected"}
            aria-label={`Reject: ${decision.title}`}
            disabled={readOnly}
            onClick={() => toggle("rejected")}
          >
            <span aria-hidden="true">✗</span> Reject
          </button>
        </div>
        <label className="visually-hidden" htmlFor={`${id}-comment`}>
          Comment on: {decision.title}
        </label>
        <textarea
          id={`${id}-comment`}
          ref={selected ? commentRef : undefined}
          className="input comment"
          rows={1}
          placeholder={readOnly ? "" : "Comment (optional)"}
          value={draft.comment}
          readOnly={readOnly}
          onChange={(event) => onComment(decision.id, event.target.value)}
        />
        {status !== null && STATUS_TEXT[status] !== "" && (
          <span className={`save-status ${status}`} role="status">
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
  <p className="decision-mention">
    Decision:{" "}
    <button type="button" className="link-button model-text" onClick={() => onGo(decision.id)}>
      {decision.title}
    </button>
  </p>
);
