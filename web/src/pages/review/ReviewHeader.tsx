import type { ReactNode } from "react";
import type { AnalysisView } from "../../../../contracts/index.ts";
import { pullRequestUrl } from "../../../../src/domain/review/index.ts";
import { type ApiError, errorMessage } from "../../api/index.ts";
import { cn } from "../../lib/utils.ts";
import { KeyHint, WARNING } from "../../review/index.ts";
import { Button } from "../../ui/button.tsx";

/** Up to this many warnings show in full; more collapse to a count. */
const SHOWN_WARNINGS = 2;

/**
 * The PR and its intent in a line, the layout switch, whether the analysis is still current, and
 * the way to publish the review.
 */
export const ReviewHeader = ({
  view,
  intent,
  tools,
  canPublish,
  reanalyzing,
  reanalyzeError,
  onReanalyze,
  onPublish,
}: {
  readonly view: AnalysisView;
  /** The intent line, under the title. */
  readonly intent: ReactNode;
  /** The layout switch, before publishing. */
  readonly tools: ReactNode;
  /** There's something to post: a decision, a line comment, or a verdict the reviewer can give. */
  readonly canPublish: boolean;
  readonly reanalyzing: boolean;
  readonly reanalyzeError: ApiError | null;
  readonly onReanalyze: () => void;
  readonly onPublish: () => void;
}) => {
  const { analysis, publication, stale } = view;
  const { pullRequest, warnings } = analysis;
  const { ref } = analysis.key;

  return (
    <header className="flex flex-col gap-3 border-b pb-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="min-w-0 text-title font-semibold tracking-[-0.01em] whitespace-pre-line">
              {pullRequest?.title ?? "Collecting the pull request…"}
            </h1>
            <a
              className="font-mono text-code-compact"
              href={pullRequest?.url ?? pullRequestUrl(ref)}
              target="_blank"
              rel="noreferrer"
            >
              {ref.repo.repo} #{ref.number}
            </a>
          </div>
          {intent}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tools}
          {publication !== null ? (
            <p role="status" className="flex items-center gap-1 font-medium text-review-approved">
              <span aria-hidden="true">✓</span>{" "}
              {publication.url === null ? (
                "Published"
              ) : (
                <a
                  href={publication.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-review-approved"
                >
                  Published
                </a>
              )}
            </p>
          ) : (
            canPublish && (
              <Button disabled={analysis.status !== "complete"} onClick={onPublish}>
                Publish…
                <KeyHint id="openReview" />
              </Button>
            )
          )}
        </div>
      </div>
      {stale && (
        <div role="status" className={cn(WARNING, "flex flex-wrap items-center gap-3")}>
          <span>This PR has new commits since the analysis.</span>
          <Button variant="outline" size="sm" disabled={reanalyzing} onClick={onReanalyze}>
            {reanalyzing ? "Starting…" : "Re-analyze"}
          </Button>
          {reanalyzeError !== null && (
            <span className="text-destructive" role="alert">
              {errorMessage(reanalyzeError)}
            </span>
          )}
        </div>
      )}
      {warnings.length > 0 && warnings.length <= SHOWN_WARNINGS && (
        <ul className="flex flex-col gap-2" aria-label="Warnings">
          {warnings.map((warning) => (
            <li key={warning} className={WARNING}>
              <span aria-hidden="true">⚠ </span>
              {warning}
            </li>
          ))}
        </ul>
      )}
      {warnings.length > SHOWN_WARNINGS && (
        <details className={WARNING}>
          <summary className="cursor-pointer">
            <span aria-hidden="true">⚠ </span>
            {warnings.length} warnings
          </summary>
          <ul className="mt-1 list-disc pl-5">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </details>
      )}
    </header>
  );
};
