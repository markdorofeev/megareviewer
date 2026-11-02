import "./review.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisView } from "../../../../contracts/index.ts";
import type { HunkId } from "../../../../src/domain/diff/index.ts";
import {
  type AnalysisId,
  type DecisionId,
  pullRequestUrl,
} from "../../../../src/domain/review/index.ts";
import { errorMessage, useAnalysisView, useApi, useMutation, useStatus } from "../../api/index.ts";
import { Link } from "../../app/Link.tsx";
import { navigate, reviewPath } from "../../app/router.ts";
import { DecisionList } from "./DecisionList.tsx";
import { FileFinder } from "./FileFinder.tsx";
import { IntentPanel } from "./IntentPanel.tsx";
import { MainArea, type MainHeading } from "./MainArea.tsx";
import {
  entryKey,
  entryOf,
  type Focus,
  hunkIndex,
  hunkLinks,
  hunksInPathOrder,
  inReadingOrder,
  type MainView,
  mechanicalCount,
  readingOrder,
  reviewOrder,
  riskMix,
  riskTotals,
  sameView,
  type TourEntry,
  tourSteps,
  trailingProofs,
  withMechanicalInPlace,
} from "./model.ts";
import { ProgressStrip, stageName } from "./ProgressStrip.tsx";
import { PublishDialog } from "./PublishDialog.tsx";
import { ReviewHeader } from "./ReviewHeader.tsx";
import { ShortcutsDialog } from "./ShortcutsDialog.tsx";
import { StatedIntent } from "./StatedIntent.tsx";
import { type ShortcutAction, useShortcuts } from "./shortcuts.ts";
import { parseBoolean, parseStrings, useStoredState } from "./storage.ts";
import { TourNav } from "./TourNav.tsx";
import { UsageFooter } from "./UsageFooter.tsx";
import { useVerdicts } from "./useVerdicts.ts";

const NONE: readonly string[] = [];
/** Reviewed marks kept across analyses, most recent last; older ones are forgotten. */
const MAX_REVIEWED = 5_000;

export const ReviewPage = ({ analysisId }: { readonly analysisId: AnalysisId }) => {
  // A retry, or a re-analysis of an unchanged PR, runs again under the same ID. A new run starts
  // the page afresh, so it follows the new run's events.
  const [run, setRun] = useState(0);
  const restart = useCallback(() => setRun((count) => count + 1), []);
  return <ReviewLoader key={`${analysisId}/${run}`} analysisId={analysisId} restart={restart} />;
};

const ReviewLoader = ({
  analysisId,
  restart,
}: {
  readonly analysisId: AnalysisId;
  readonly restart: () => void;
}) => {
  const { view, error, refetch } = useAnalysisView(analysisId);
  if (view === null) {
    if (error?.code === "not-found") {
      return (
        <div className="narrow">
          <h1>Analysis not found</h1>
          <p>{errorMessage(error)}</p>
          <p>
            <Link to="/">Pick a pull request to review</Link>
          </p>
        </div>
      );
    }
    if (error !== null) {
      return (
        <div className="narrow">
          <p className="banner danger" role="alert">
            Couldn't load the analysis. {errorMessage(error)}
          </p>
          <button type="button" className="button" onClick={() => void refetch()}>
            Try again
          </button>
        </div>
      );
    }
    return <ReviewSkeleton />;
  }
  return <Review view={view} refetch={refetch} restart={restart} />;
};

const ReviewSkeleton = () => (
  <div className="review-page" role="status" aria-busy="true" aria-label="Loading the analysis">
    <div className="skeleton skeleton-title" />
    <div className="skeleton skeleton-panel" />
    <div className="review-body">
      <div className="skeleton skeleton-sidebar" />
      <div className="skeleton skeleton-main" />
    </div>
  </div>
);

const Review = ({
  view,
  refetch,
  restart,
}: {
  readonly view: AnalysisView;
  readonly refetch: () => Promise<void>;
  readonly restart: () => void;
}) => {
  const { client } = useApi();
  // Until the status says otherwise, a missing intent is still coming from the model.
  const modelOn = useStatus().status?.model.enabled !== false;
  const { analysis, publication, isAuthor } = view;
  const analysisId = analysis.id;
  const complete = analysis.status === "complete";
  const readOnly = publication !== null || !complete;

  const index = useMemo(() => hunkIndex(analysis), [analysis]);
  const steps = useMemo(() => tourSteps(analysis, index), [analysis, index]);
  const order = useMemo(() => readingOrder(analysis, steps), [analysis, steps]);
  const trailing = useMemo(() => trailingProofs(analysis, index), [analysis, index]);
  const mechanical = mechanicalCount(trailing);
  const totals = useMemo(() => riskTotals(analysis, index), [analysis, index]);
  const contractHunks = useMemo(
    () =>
      new Set(
        analysis.risk.flatMap((risk) => (risk.riskClass === "contract" ? [risk.hunkId] : [])),
      ),
    [analysis.risk],
  );
  const { mixes, contractCounts } = useMemo(
    () => ({
      mixes: new Map(
        steps.map((step) => [step.id, riskMix(withMechanicalInPlace(step.hunkIds, index), index)]),
      ),
      contractCounts: new Map(
        steps.map((step) => [step.id, step.hunkIds.filter((id) => contractHunks.has(id)).length]),
      ),
    }),
    [steps, index, contractHunks],
  );
  const tourReady = analysis.tour !== null;
  const entries = useMemo(
    (): readonly TourEntry[] => [
      ...steps.map((step) => ({ kind: "step" as const, stepId: step.id })),
      { kind: "mechanical" as const },
    ],
    [steps],
  );

  const [chosen, setChosen] = useState<MainView | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [focusedHunkId, setFocusedHunkId] = useState<HunkId | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [finding, setFinding] = useState(false);
  // Where each followed call-graph link came from, for Esc to go back.
  const [trail, setTrail] = useState<readonly { entry: TourEntry; hunkId: HunkId | null }[]>([]);
  const pendingFocus = useRef<HunkId | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const commentField = useRef<HTMLTextAreaElement | null>(null);
  const setCommentField = useCallback((field: HTMLTextAreaElement | null) => {
    commentField.current = field;
  }, []);

  // Before the tour exists, every change shows in path order; a chosen entry that no longer
  // exists falls back to the first.
  const mainView = useMemo(
    (): MainView =>
      !tourReady
        ? { kind: "files" }
        : chosen !== null && entries.some((entry) => sameView(entry, chosen))
          ? chosen
          : (entries[0] ?? { kind: "mechanical" }),
    [chosen, entries, tourReady],
  );
  const entryIndex = entries.findIndex((entry) => sameView(entry, mainView));

  const [visitedList, setVisited] = useStoredState(`visited:${analysisId}`, NONE, parseStrings);
  const [contractOnly, setContractOnly] = useStoredState(
    `contract-only:${analysisId}`,
    false,
    parseBoolean,
  );
  const visited = useMemo(() => new Set(visitedList), [visitedList]);
  const mainKey = entryKey(mainView);
  useEffect(() => {
    if (!tourReady) return;
    setVisited((previous) => (previous.includes(mainKey) ? previous : [...previous, mainKey]));
  }, [mainKey, tourReady, setVisited]);

  const links = useMemo(() => hunkLinks(analysis.callGraph, index), [analysis.callGraph, index]);
  const linksOf = useCallback((id: HunkId) => links.get(id) ?? [], [links]);
  // Kept by hunk ID, not by analysis: a hunk a new push didn't change stays reviewed.
  const [reviewedList, setReviewedList] = useStoredState("reviewed-hunks", NONE, parseStrings);
  const reviewedHunks = useMemo(() => new Set(reviewedList), [reviewedList]);
  const toReview = useMemo(() => reviewOrder(steps), [steps]);
  const reviewed = useMemo(
    () => ({
      done: toReview.filter(({ hunkId }) => reviewedHunks.has(hunkId)).length,
      of: toReview.length,
      steps: new Set<string>(
        steps
          .filter((step) => step.hunkIds.length > 0)
          .filter((step) => step.hunkIds.every((id) => reviewedHunks.has(id)))
          .map((step) => step.id),
      ),
    }),
    [toReview, reviewedHunks, steps],
  );
  const setHunkReviewed = useCallback(
    (id: HunkId, value: boolean) =>
      setReviewedList((previous) => {
        const without = previous.filter((other) => other !== id);
        return value ? [...without, id].slice(-MAX_REVIEWED) : without;
      }),
    [setReviewedList],
  );

  const verdicts = useVerdicts(analysisId, view.verdicts);
  const selectedDecision = focus?.kind === "decision" ? focus.decisionId : null;

  // What the main area shows, and its heading.
  const shown = useMemo((): {
    readonly heading: MainHeading;
    readonly ids: readonly HunkId[];
    readonly highlighted?: ReadonlySet<HunkId>;
  } => {
    if (focus?.kind === "decision") {
      const decision = analysis.decisions.find((d) => d.id === focus.decisionId);
      const ids = inReadingOrder(decision?.hunkIds ?? [], order);
      return {
        heading: {
          kind: "decision",
          title: decision?.title ?? "",
          detail: decision?.whyItMatters ?? "",
        },
        ids,
        highlighted: new Set(ids),
      };
    }
    if (focus?.kind === "mismatch") {
      const mismatch = analysis.intent?.mismatches[focus.index];
      const ids = inReadingOrder(mismatch?.hunkIds ?? [], order);
      return {
        heading: { kind: "mismatch", title: mismatch?.description ?? "", detail: "" },
        ids,
        highlighted: new Set(ids),
      };
    }
    if (mainView.kind === "step") {
      const number = steps.findIndex((step) => step.id === mainView.stepId);
      const step = steps[number];
      if (step !== undefined) {
        return {
          heading: { kind: "step", step, number: number + 1, of: steps.length },
          ids: withMechanicalInPlace(step.hunkIds, index),
        };
      }
    }
    if (mainView.kind === "files") {
      return {
        heading: { kind: "files" },
        ids: withMechanicalInPlace(hunksInPathOrder(analysis, index), index),
      };
    }
    return { heading: { kind: "mechanical" }, ids: [] };
  }, [analysis, focus, index, mainView, order, steps]);
  // "Contract changes only" narrows the tour, never a decision or mismatch the reviewer opened.
  const filtered = contractOnly && focus === null;
  const items = useMemo(
    () => index.items(filtered ? shown.ids.filter((id) => contractHunks.has(id)) : shown.ids),
    [index, shown.ids, filtered, contractHunks],
  );

  // j starts from a new view's first hunk. A view the reviewer picked scrolls to its top; one that
  // changes by itself, like the tour arriving, doesn't move the page.
  const viewKey =
    focus === null
      ? mainKey
      : focus.kind === "decision"
        ? `decision:${focus.decisionId}`
        : `mismatch:${focus.index}`;
  const scrollOnChange = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the view changes.
  useEffect(() => {
    // A followed link focuses its hunk, which scrolls to it, instead of the view's top.
    const target = pendingFocus.current;
    pendingFocus.current = null;
    setFocusedHunkId(target);
    if (scrollOnChange.current && target === null) {
      mainRef.current?.scrollIntoView({ block: "start" });
    }
    scrollOnChange.current = false;
  }, [viewKey]);

  const goTo = useCallback((entry: TourEntry) => {
    scrollOnChange.current = true;
    setFocus(null);
    setChosen(entry);
  }, []);
  const changeFocus = (update: (previous: Focus | null) => Focus | null) => {
    scrollOnChange.current = true;
    setFocus(update);
  };
  /** Shows a hunk wherever the tour has it, and focuses it. */
  const goToHunk = (id: HunkId) => {
    if (filtered && !contractHunks.has(id)) setContractOnly(() => false);
    const entry = entryOf(id, steps, index);
    if (!tourReady || (focus === null && sameView(entry, mainView))) {
      setFocusedHunkId(id);
      return;
    }
    pendingFocus.current = id;
    goTo(entry);
  };
  const currentEntry = (): TourEntry =>
    mainView.kind === "files" ? { kind: "mechanical" } : mainView;
  const follow = (id: HunkId) => {
    if (tourReady)
      setTrail((previous) => [...previous, { entry: currentEntry(), hunkId: focusedHunkId }]);
    goToHunk(id);
  };
  const goBack = () => {
    const last = trail.at(-1);
    if (last === undefined) return;
    setTrail((previous) => previous.slice(0, -1));
    if (last.hunkId !== null) goToHunk(last.hunkId);
    else goTo(last.entry);
  };
  /** The next or previous hunk to review that isn't marked reviewed, across steps. */
  const goToUnreviewed = (direction: 1 | -1) => {
    let at = toReview.findIndex((item) => item.hunkId === focusedHunkId);
    if (at === -1) {
      const first = toReview.findIndex(
        (item) => mainView.kind === "step" && item.stepId === mainView.stepId,
      );
      at =
        first === -1 ? (direction === 1 ? -1 : toReview.length) : first - (direction === 1 ? 1 : 0);
    }
    for (let i = at + direction; i >= 0 && i < toReview.length; i += direction) {
      const item = toReview[i];
      if (item !== undefined && !reviewedHunks.has(item.hunkId)) return goToHunk(item.hunkId);
    }
  };

  const previousEntry = tourReady && entryIndex > 0 ? entries[entryIndex - 1] : undefined;
  const nextEntry = tourReady && entryIndex >= 0 ? entries[entryIndex + 1] : undefined;

  const selectDecision = (id: DecisionId) =>
    changeFocus((previous) =>
      previous?.kind === "decision" && previous.decisionId === id
        ? null
        : { kind: "decision", decisionId: id },
    );
  const selectMismatch = (mismatchIndex: number) =>
    changeFocus((previous) =>
      previous?.kind === "mismatch" && previous.index === mismatchIndex
        ? null
        : { kind: "mismatch", index: mismatchIndex },
    );

  const toggleVerdict = (id: DecisionId, verdict: "approved" | "rejected") => {
    if (readOnly) return;
    const current = verdicts.draftOf(id).verdict;
    verdicts.setVerdict(id, current === verdict ? "pending" : verdict);
  };

  const moveHunk = (step: 1 | -1) => {
    if (items.length === 0) return;
    const at = items.findIndex((item) => item.hunk.id === focusedHunkId);
    const next = at === -1 ? (step === 1 ? 0 : items.length - 1) : at + step;
    const item = items[Math.min(Math.max(next, 0), items.length - 1)];
    if (item !== undefined) setFocusedHunkId(item.hunk.id);
  };

  const onShortcut = (action: ShortcutAction) => {
    switch (action) {
      case "next-hunk":
        return moveHunk(1);
      case "previous-hunk":
        return moveHunk(-1);
      case "next-step":
        if (nextEntry !== undefined) goTo(nextEntry);
        return;
      case "previous-step":
        if (previousEntry !== undefined) goTo(previousEntry);
        return;
      case "approve":
        if (selectedDecision !== null) toggleVerdict(selectedDecision, "approved");
        return;
      case "reject":
        if (selectedDecision !== null) toggleVerdict(selectedDecision, "rejected");
        return;
      case "toggle-reviewed":
        if (focusedHunkId !== null && !index.mechanical.has(focusedHunkId)) {
          setHunkReviewed(focusedHunkId, !reviewedHunks.has(focusedHunkId));
          moveHunk(1);
        }
        return;
      case "next-unreviewed":
        return goToUnreviewed(1);
      case "previous-unreviewed":
        return goToUnreviewed(-1);
      case "find-file":
        setFinding(true);
        return;
      case "comment":
        commentField.current?.focus();
        return;
      case "escape":
        if (focus !== null) changeFocus(() => null);
        else goBack();
        return;
      case "help":
        setShowShortcuts(true);
        return;
    }
  };
  useShortcuts(!publishing && !showShortcuts && !finding, onShortcut);

  const prUrl = analysis.pullRequest?.url ?? pullRequestUrl(analysis.key.ref);
  const reanalyze = useMutation(client.startAnalysis);
  const retry = useMutation(client.retryAnalysis);
  const open = (id: AnalysisId) => {
    if (id === analysisId) restart();
    else navigate(reviewPath(id));
  };

  const openPublish = async () => {
    await verdicts.flush();
    setPublishing(true);
  };

  const pendingCount = analysis.decisions.filter(
    (decision) => verdicts.draftOf(decision.id).verdict === "pending",
  ).length;
  const failureTitle =
    verdicts.failure === null
      ? ""
      : (analysis.decisions.find((d) => d.id === verdicts.failure?.decisionId)?.title ?? "");

  return (
    <div className="review-page">
      <ReviewHeader
        view={view}
        reanalyzing={reanalyze.pending}
        reanalyzeError={reanalyze.error}
        onReanalyze={async () => {
          const result = await reanalyze.run({ url: prUrl });
          if (result.ok) open(result.value.analysisId);
        }}
        onPublish={() => void openPublish()}
      />

      {!complete && <ProgressStrip stages={analysis.stages} filesFetched={analysis.filesFetched} />}
      {analysis.error !== null && (
        <div className="banner danger failed-banner" role="alert">
          <p>
            The analysis failed at the {stageName(analysis.error.stage).toLowerCase()} stage:{" "}
            {analysis.error.message}
          </p>
          {retry.error !== null && <p>Couldn't retry. {errorMessage(retry.error)}</p>}
          <button
            type="button"
            className="button"
            disabled={retry.pending}
            onClick={async () => {
              const result = await retry.run(analysisId);
              if (result.ok) open(result.value.analysisId);
            }}
          >
            {retry.pending ? "Retrying…" : "Retry"}
          </button>
        </div>
      )}

      {analysis.intent !== null ? (
        <IntentPanel
          analysisId={analysisId}
          intent={analysis.intent}
          tickets={analysis.tickets}
          missingTicketKeys={analysis.missingTicketKeys}
          selectedMismatch={focus?.kind === "mismatch" ? focus.index : null}
          onSelectMismatch={selectMismatch}
        />
      ) : modelOn && analysis.status === "running" ? (
        <div className="intent-panel pending" aria-busy="true">
          <p className="muted intent-pending">Working out the intent…</p>
        </div>
      ) : (
        analysis.pullRequest !== null && (
          <StatedIntent
            analysisId={analysisId}
            pullRequest={analysis.pullRequest}
            tickets={analysis.tickets}
            missingTicketKeys={analysis.missingTicketKeys}
          />
        )
      )}

      <div className="review-body">
        <aside className="review-sidebar">
          {tourReady ? (
            <TourNav
              steps={steps}
              mechanicalCount={mechanical}
              mixes={mixes}
              contractCounts={contractCounts}
              totals={totals}
              reviewed={reviewed}
              contractOnly={contractOnly}
              onContractOnly={(value) => setContractOnly(() => value)}
              current={focus === null ? mainView : null}
              visited={visited}
              onSelect={goTo}
            />
          ) : (
            <section className="tour-nav">
              <h2>Tour</h2>
              <p className="muted">
                {analysis.status === "running"
                  ? "Building the tour…"
                  : "No tour for this analysis."}
              </p>
            </section>
          )}
          {verdicts.failure !== null && (
            <div className="banner danger" role="alert">
              <p>
                Couldn't save your {verdicts.failure.what} on “{failureTitle}”.{" "}
                {verdicts.failure.message}
              </p>
              <button type="button" className="button quiet" onClick={verdicts.dismissFailure}>
                Dismiss
              </button>
            </div>
          )}
          {analysis.stages.decisions === "done" ? (
            <>
              {!complete && publication === null && (
                <p className="muted">You can give verdicts once the analysis is complete.</p>
              )}
              {analysis.decisions.length === 0 ? (
                <section className="decision-list">
                  <h2>Decisions</h2>
                  <p className="muted">The analysis found no decisions to review.</p>
                </section>
              ) : (
                <DecisionList
                  decisions={analysis.decisions}
                  draftOf={verdicts.draftOf}
                  statusOf={verdicts.statusOf}
                  selected={selectedDecision}
                  readOnly={readOnly}
                  commentRef={setCommentField}
                  onSelect={selectDecision}
                  onVerdict={verdicts.setVerdict}
                  onComment={verdicts.setComment}
                />
              )}
            </>
          ) : (
            modelOn &&
            analysis.status === "running" && (
              <section className="decision-list">
                <h2>Decisions</h2>
                <p className="muted">Finding the decisions the code makes…</p>
              </section>
            )
          )}
        </aside>

        {analysis.stages.prep === "done" ? (
          <MainArea
            ref={mainRef}
            analysis={analysis}
            view={mainView}
            heading={shown.heading}
            items={items}
            highlightedHunkIds={shown.highlighted}
            focusedHunkId={focusedHunkId}
            mechanicalCount={mechanical}
            trailingProofs={trailing}
            contractOnly={filtered}
            linksOf={linksOf}
            onFollow={follow}
            reviewedHunkIds={reviewedHunks}
            onReviewed={setHunkReviewed}
            onFocusHunk={setFocusedHunkId}
            onBack={() => changeFocus(() => null)}
            onPrevious={previousEntry === undefined ? null : () => goTo(previousEntry)}
            onNext={nextEntry === undefined ? null : () => goTo(nextEntry)}
          />
        ) : (
          <section className="main-area" aria-busy={analysis.status === "running"}>
            <p className="muted">
              {analysis.status === "running"
                ? "Reading the diff…"
                : "The diff couldn't be read, so there are no changes to show."}
            </p>
          </section>
        )}
      </div>

      <UsageFooter usage={analysis.usage} />

      {publishing && (
        <PublishDialog
          analysisId={analysisId}
          isAuthor={isAuthor}
          pendingCount={pendingCount}
          onClose={() => setPublishing(false)}
          onPublished={() => {
            setPublishing(false);
            void refetch();
          }}
        />
      )}
      {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
      {finding && (
        <FileFinder
          files={analysis.files}
          onClose={() => setFinding(false)}
          onPick={(file) => {
            setFinding(false);
            const first =
              file.hunks.find((hunk) => !index.mechanical.has(hunk.id)) ?? file.hunks[0];
            if (first !== undefined) goToHunk(first.id);
          }}
        />
      )}
      <p className="shortcut-hint muted">
        Press <kbd>?</kbd> for keyboard shortcuts.
      </p>
    </div>
  );
};
