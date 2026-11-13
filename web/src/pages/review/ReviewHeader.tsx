import type { ReactNode } from "react";
import type { AnalysisView } from "../../../../contracts/index.ts";
import { pullRequestUrl } from "../../../../src/domain/review/index.ts";
import { type ApiError, errorMessage } from "../../api/index.ts";
import { cn } from "../../lib/utils.ts";
import { WARNING } from "../../review/index.ts";
import { Button } from "../../ui/button.tsx";

export type HairlineState = "running" | "finishing";

/** Up to this many warnings show in full; more collapse to a count. */
const SHOWN_WARNINGS = 2;

/**
 * The PR and its intent in a line, the layout switch, whether the analysis is still current, and
 * whether the review is published. Publishing itself is the floating button, in reach anywhere.
 */
export const ReviewHeader = ({
  view,
  intent,
  tools,
  hairline,
  reanalyzing,
  reanalyzeError,
  onReanalyze,
}: {
  readonly view: AnalysisView;
  /** The intent line, under the title. */
  readonly intent: ReactNode;
  /** The layout switch. */
  readonly tools: ReactNode;
  /**
   * Claude is reading the PR: a segment runs along the header's bottom edge. Once it's done, it
   * runs out to the full width and fades.
   */
  readonly hairline: HairlineState | null;
  readonly reanalyzing: boolean;
  readonly reanalyzeError: ApiError | null;
  readonly onReanalyze: () => void;
}) => {
  const { analysis, publication, stale } = view;
  const { pullRequest, warnings } = analysis;
  const { ref } = analysis.key;

  return (
    <header className="relative flex flex-col gap-3 border-b pb-3">
      {hairline !== null && (
        // Drawn by globals.css: a still, full-width bar under reduced motion.
        <span data-slot="model-hairline" data-state={hairline} aria-hidden="true">
          <span />
        </span>
      )}
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
          {publication !== null && (
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
