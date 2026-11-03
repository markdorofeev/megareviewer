import "./review.css";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import type { AnalysisView } from "../../../../contracts/index.ts";
import type { HunkId } from "../../../../src/domain/diff/index.ts";
import {
  type AnalysisId,
  type Decision,
  type DecisionId,
  HunkComment,
  pullRequestUrl,
} from "../../../../src/domain/review/index.ts";
import { errorMessage, useAnalysisView, useApi, useMutation, useStatus } from "../../api/index.ts";
import { Link } from "../../app/Link.tsx";
import { navigate, reviewPath } from "../../app/router.ts";
import { commentPlace, type LineComment, type LinePlace } from "../../diff/index.ts";
import { callTree, treeOrder } from "./call-tree.ts";
import { DecisionCard, DecisionMention, decisionAnchor } from "./DecisionCard.tsx";
import { Dialog } from "./Dialog.tsx";
import { type HunkDeps, hunkAnchor } from "./HunkView.tsx";
import { IntentLine } from "./IntentLine.tsx";
import { IntentPanel } from "./IntentPanel.tsx";
import { JumpPalette } from "./JumpPalette.tsx";
import {
  callKey,
  MapLayout,
  MECHANICAL_ANCHOR,
  type ScrollRequest,
  stepAnchor,
} from "./MapLayout.tsx";
import {
  callsByLine,
  decisionPlaces,
  firstCall,
  hunkIndex,
  hunkLinks,
  type Layout,
  mapSections,
  mechanicalCount,
  parseLayout,
  reviewOrder,
  riskTotals,
  sectionKey,
  tourSteps,
  trailingProofs,
} from "./model.ts";
import { ProgressStrip, stageName } from "./ProgressStrip.tsx";
import { PublishDialog } from "./PublishDialog.tsx";
import { type PaletteTarget, paletteItems } from "./palette.ts";
import { ReviewHeader } from "./ReviewHeader.tsx";
import { type RailTarget, RiskRail } from "./RiskRail.tsx";
import { ShortcutsDialog } from "./ShortcutsDialog.tsx";
import { StatedIntent } from "./StatedIntent.tsx";
import { type ShortcutAction, useShortcuts } from "./shortcuts.ts";
import { parseBoolean, parseStrings, useStoredState } from "./storage.ts";
import { TreeLayout } from "./TreeLayout.tsx";
import { UsageFooter } from "./UsageFooter.tsx";
import { useVerdicts } from "./useVerdicts.ts";

const NONE: readonly string[] = [];
const NO_COMMENTS: readonly HunkComment[] = [];
const parseHunkComments = (stored: unknown): readonly HunkComment[] | undefined =>
  HunkComment.array().safeParse(stored).data;

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
    <div className="review-body map">
      <div className="skeleton skeleton-main" />
      <div className="skeleton skeleton-rail" />
    </div>
  </div>
);

const NO_DECISIONS: readonly Decision[] = [];

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
  const sections = useMemo(() => mapSections(analysis, steps, index), [analysis, steps, index]);
  const order = useMemo(() => sections.flatMap((section) => section.hunkIds), [sections]);
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
  const places = useMemo(
    () => decisionPlaces(analysis.decisions, order, index),
    [analysis.decisions, order, index],
  );
  const restingOn = useMemo(() => {
    const on = new Map<HunkId, Decision[]>();
    for (const decision of analysis.decisions)
      for (const id of new Set(decision.hunkIds)) on.set(id, [...(on.get(id) ?? []), decision]);
    return on;
  }, [analysis.decisions]);
  const calls = useMemo(() => callsByLine(analysis.callGraph, index), [analysis.callGraph, index]);
  const links = useMemo(() => hunkLinks(analysis.callGraph, index), [analysis.callGraph, index]);
  const linksOf = useCallback((id: HunkId) => links.get(id) ?? [], [links]);
  const tree = useMemo(() => {
    // Roots come from steps with contract hunks first, then the tour's order.
    const contract = steps.filter((step) => step.hunkIds.some((id) => contractHunks.has(id)));
    const ids = [...contract, ...steps.filter((step) => !contract.includes(step))]
      .flatMap((step) => step.hunkIds)
      .filter((id) => !index.mechanical.has(id));
    return callTree(
      [...new Set(ids)],
      analysis.callGraph,
      (id) => index.hunks.get(id)?.file.path ?? "",
    );
  }, [steps, contractHunks, index, analysis.callGraph]);
  const inTreeOrder = useMemo(() => treeOrder(tree), [tree]);
  const placedIn = useMemo(
    () =>
      new Map(
        tree.rows.flatMap((row) =>
          row.kind === "hunk" ? [[row.hunkId, row.parent] as const] : [],
        ),
      ),
    [tree],
  );

  const [layout, setLayout] = useStoredState("review-layout", "map", parseLayout);
  const [contractOnly, setContractOnly] = useStoredState(
    `contract-only:${analysisId}`,
    false,
    parseBoolean,
  );
  const [focusedHunkId, setFocusedHunkId] = useState<HunkId | null>(null);
  const [treeHunk, setTreeHunk] = useState<HunkId | null>(null);
  const [treeFocus, setTreeFocus] = useState(false);
  const treeSelected = treeHunk ?? inTreeOrder[0] ?? null;
  // Where each call followed in the tree came from, for ← to go back.
  const [treeTrail, setTreeTrail] = useState<readonly HunkId[]>([]);
  // Where each "called by" link followed in the map came from, for Esc to go back.
  const [trail, setTrail] = useState<readonly HunkId[]>([]);
  const [selectedDecision, setSelectedDecision] = useState<DecisionId | null>(null);
  // The hunks of a decision or mismatch the reviewer went to.
  const [highlight, setHighlight] = useState<ReadonlySet<HunkId>>(new Set());
  const [mismatchAt, setMismatchAt] = useState(0);
  const [openCalls, setOpenCalls] = useState<ReadonlySet<string>>(new Set());
  const [scrollRequest, setScrollRequest] = useState<ScrollRequest | null>(null);
  // After n or p, the hunk j goes to: the step's first.
  const [startAt, setStartAt] = useState<HunkId | null>(null);
  const inView = useRef<readonly HunkId[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [jumping, setJumping] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const commentField = useRef<HTMLTextAreaElement | null>(null);
  const setCommentField = useCallback((field: HTMLTextAreaElement | null) => {
    commentField.current = field;
  }, []);

  // Kept by hunk ID, not by analysis: a hunk a new push didn't change stays reviewed.
  const [reviewedList, setReviewedList] = useStoredState("reviewed-hunks", NONE, parseStrings);
  const reviewedHunks = useMemo(() => new Set(reviewedList), [reviewedList]);
  const toReview = useMemo(() => reviewOrder(sections, index), [sections, index]);
  const reviewedCount = toReview.filter((id) => reviewedHunks.has(id)).length;
  const setHunkReviewed = useCallback(
    (id: HunkId, value: boolean) =>
      setReviewedList((previous) => {
        const without = previous.filter((other) => other !== id);
        return value ? [...without, id].slice(-MAX_REVIEWED) : without;
      }),
    [setReviewedList],
  );

  // Comments on hunk lines are drafts in this browser until they're published with the review.
  const [hunkComments, setHunkComments] = useStoredState(
    `hunk-comments:${analysisId}`,
    NO_COMMENTS,
    parseHunkComments,
  );
  const [openComment, setOpenComment] = useState<{ hunkId: HunkId; place: LinePlace } | null>(null);
  const commentsOf = useCallback(
    (id: HunkId) => hunkComments.filter((comment) => comment.hunkId === id),
    [hunkComments],
  );
  const writeComment = useCallback(
    (hunkId: HunkId, comment: LineComment) =>
      setHunkComments((previous) => {
        const same = (other: HunkComment) =>
          other.hunkId === hunkId && other.side === comment.side && other.line === comment.line;
        const written = { hunkId, ...comment };
        if (!previous.some(same)) return comment.body === "" ? previous : [...previous, written];
        return comment.body === ""
          ? previous.filter((other) => !same(other))
          : previous.map((other) => (same(other) ? written : other));
      }),
    [setHunkComments],
  );
  const openCommentOn = useCallback(
    (hunkId: HunkId, place: LinePlace | null) =>
      setOpenComment(place === null ? null : { hunkId, place }),
    [],
  );

  const verdicts = useVerdicts(analysisId, view.verdicts);

  const scrollTo = (id: string) =>
    setScrollRequest((previous) => ({ id, n: (previous?.n ?? 0) + 1 }));
  const shownInMap = (id: HunkId) => !contractOnly || contractHunks.has(id);
  /** The hunk the reviewer is on: the focused one in the map if it's in view, else the first in view. */
  const currentHunk = (): HunkId | null => {
    if (layout === "tree") return treeSelected;
    const visible = inView.current;
    if (focusedHunkId !== null && (visible.length === 0 || visible.includes(focusedHunkId)))
      return focusedHunkId;
    return visible[0] ?? focusedHunkId;
  };

  /** A decision's card goes with the hunk the reviewer is on, for a, r and c. */
  const focusHunk = useCallback(
    (id: HunkId) => {
      setFocusedHunkId(id);
      const cards = places.cards.get(id) ?? NO_DECISIONS;
      setSelectedDecision((previous) =>
        cards.some((decision) => decision.id === previous) ? previous : (cards[0]?.id ?? null),
      );
    },
    [places],
  );
  const selectInTree = (id: HunkId, from?: HunkId) => {
    setTreeHunk(id);
    setTreeFocus(true);
    setTreeTrail((previous) => (from === undefined ? [] : [...previous, from]));
  };
  /** Shows a hunk: scrolls to it in the map, selects it in the tree. */
  const showHunk = (id: HunkId, inLayout: Layout = layout) => {
    if (inLayout === "tree") return selectInTree(id);
    if (!shownInMap(id)) setContractOnly(() => false);
    scrollTo(order.includes(id) ? hunkAnchor(id) : MECHANICAL_ANCHOR);
  };
  const goToDecision = (id: DecisionId) => {
    const decision = analysis.decisions.find((one) => one.id === id);
    const cardHunk = places.cardHunk.get(id);
    setHighlight(new Set(decision?.hunkIds ?? []));
    if (layout === "tree") {
      if (cardHunk !== undefined) selectInTree(cardHunk);
    } else {
      if (cardHunk !== undefined && !shownInMap(cardHunk)) setContractOnly(() => false);
      scrollTo(decisionAnchor(id));
    }
    setSelectedDecision(id);
  };
  const goToMismatch = (at: number) => {
    const mismatch = analysis.intent?.mismatches[at];
    if (mismatch === undefined) return;
    const ids = mismatch.hunkIds
      .filter((id) => index.hunks.has(id))
      .sort((a, b) => order.indexOf(a) - order.indexOf(b));
    setHighlight(new Set(ids));
    setMismatchAt(at + 1);
    const [first] = ids;
    if (first !== undefined) showHunk(first);
  };
  const goToSection = (key: string) => {
    const section = sections.find((one) => sectionKey(one) === key);
    if (section === undefined) return;
    if (layout === "tree") {
      const first = section.hunkIds.find((id) => !index.mechanical.has(id));
      if (first !== undefined) selectInTree(first);
      return;
    }
    if (contractOnly && !section.hunkIds.some((id) => contractHunks.has(id)))
      setContractOnly(() => false);
    setFocusedHunkId(null);
    setStartAt(section.hunkIds.find(shownInMap) ?? null);
    scrollTo(stepAnchor(key));
  };
  const goToMechanical = () => {
    if (contractOnly) setContractOnly(() => false);
    scrollTo(MECHANICAL_ANCHOR);
  };
  const follow = (id: HunkId) => {
    const from = currentHunk();
    if (from !== null) setTrail((previous) => [...previous, from]);
    showHunk(id);
  };

  const switchLayout = () => {
    const current = currentHunk();
    if (layout === "map") {
      if (current !== null) selectInTree(current);
      setLayout(() => "tree");
    } else {
      setLayout(() => "map");
      if (current !== null) showHunk(current, "map");
    }
  };

  const mapItems = order.filter(shownInMap);
  const moveHunk = (step: 1 | -1) => {
    if (layout === "tree") {
      const at = treeSelected === null ? -1 : inTreeOrder.indexOf(treeSelected);
      const next = inTreeOrder[Math.min(Math.max(at + step, 0), inTreeOrder.length - 1)];
      if (next !== undefined) selectInTree(next);
      return;
    }
    if (mapItems.length === 0) return;
    const at = focusedHunkId === null ? -1 : mapItems.indexOf(focusedHunkId);
    const from = startAt ?? inView.current.find(shownInMap) ?? null;
    const base = from === null ? -1 : mapItems.indexOf(from);
    const next =
      at !== -1
        ? at + step
        : base === -1
          ? step === 1
            ? 0
            : mapItems.length - 1
          : step === 1
            ? base
            : base - 1;
    setStartAt(null);
    const target = mapItems[Math.min(Math.max(next, 0), mapItems.length - 1)];
    if (target !== undefined) scrollTo(hunkAnchor(target));
  };
  const moveStep = (step: 1 | -1) => {
    const shown = sections.filter((section) => section.hunkIds.some(shownInMap));
    const current = currentHunk() ?? startAt;
    const at = shown.findIndex((section) =>
      current === null ? false : section.hunkIds.includes(current),
    );
    const next = shown[at + step];
    if (next !== undefined) goToSection(sectionKey(next));
  };
  /** The next or previous hunk to review that isn't marked reviewed. */
  const goToUnreviewed = (direction: 1 | -1) => {
    const list = layout === "tree" ? inTreeOrder : toReview.filter(shownInMap);
    const current = currentHunk();
    const at = current === null ? (direction === 1 ? -1 : list.length) : list.indexOf(current);
    for (let i = at + direction; i >= 0 && i < list.length; i += direction) {
      const id = list[i];
      if (id !== undefined && !reviewedHunks.has(id)) return showHunk(id);
    }
  };

  const toggleVerdict = (id: DecisionId, verdict: "approved" | "rejected") => {
    if (readOnly) return;
    const current = verdicts.draftOf(id).verdict;
    verdicts.setVerdict(id, current === verdict ? "pending" : verdict);
  };
  const toggleCall = useCallback(
    (key: string) =>
      setOpenCalls((previous) => {
        const next = new Set(previous);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
    [],
  );

  const onShortcut = (action: ShortcutAction) => {
    const current = currentHunk();
    switch (action) {
      case "next-hunk":
        return moveHunk(1);
      case "previous-hunk":
        return moveHunk(-1);
      case "next-step":
        return moveStep(1);
      case "previous-step":
        return moveStep(-1);
      case "open-call": {
        const call = current === null ? null : firstCall(calls.get(current));
        if (current !== null && call !== null) toggleCall(callKey([current], call));
        return;
      }
      case "first-call": {
        const call = current === null ? null : firstCall(calls.get(current));
        if (current !== null && call !== null) selectInTree(call.toHunkId, current);
        return;
      }
      case "back-to-caller": {
        const caller = treeTrail.at(-1) ?? (current === null ? null : placedIn.get(current));
        if (caller === undefined || caller === null) return;
        setTreeHunk(caller);
        setTreeFocus(true);
        setTreeTrail((previous) => previous.slice(0, -1));
        return;
      }
      case "approve":
        if (selectedDecision !== null) toggleVerdict(selectedDecision, "approved");
        return;
      case "reject":
        if (selectedDecision !== null) toggleVerdict(selectedDecision, "rejected");
        return;
      case "toggle-reviewed":
        if (current !== null && !index.mechanical.has(current)) {
          setHunkReviewed(current, !reviewedHunks.has(current));
          moveHunk(1);
        }
        return;
      case "next-unreviewed":
        return goToUnreviewed(1);
      case "previous-unreviewed":
        return goToUnreviewed(-1);
      case "jump":
        setJumping(true);
        return;
      case "toggle-layout":
        return switchLayout();
      case "comment": {
        if (selectedDecision !== null && commentField.current !== null) {
          commentField.current.focus();
          return;
        }
        // Without a decision selected, comment on the hunk's first changed line.
        const found = current === null ? undefined : index.hunks.get(current);
        const line = found?.hunk.lines.find((one) => one.kind !== "context");
        if (readOnly || found === undefined || line === undefined) return;
        const place = commentPlace(line);
        if (place !== null) setOpenComment({ hunkId: found.hunk.id, place });
        return;
      }
      case "escape": {
        if (highlight.size > 0) return setHighlight(new Set());
        const last = trail.at(-1);
        if (layout === "map" && last !== undefined) {
          setTrail((previous) => previous.slice(0, -1));
          showHunk(last);
        }
        return;
      }
      case "help":
        setShowShortcuts(true);
        return;
    }
  };
  useShortcuts(!publishing && !showShortcuts && !jumping && !showDetails, layout, onShortcut);

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

  const card = (decision: Decision) => (
    <DecisionCard
      key={decision.id}
      decision={decision}
      draft={verdicts.draftOf(decision.id)}
      status={verdicts.statusOf(decision.id)}
      selected={selectedDecision === decision.id}
      readOnly={readOnly}
      commentRef={setCommentField}
      onSelect={setSelectedDecision}
      onVerdict={verdicts.setVerdict}
      onComment={verdicts.setComment}
    />
  );
  const decisionsOn = (id: HunkId): ReactNode => {
    const cards = places.cards.get(id) ?? NO_DECISIONS;
    const mentions = places.mentions.get(id) ?? NO_DECISIONS;
    if (cards.length === 0 && mentions.length === 0) return null;
    return (
      <div className="hunk-decisions">
        {cards.map(card)}
        {mentions.map((decision) => (
          <DecisionMention key={decision.id} decision={decision} onGo={goToDecision} />
        ))}
      </div>
    );
  };
  const deps: HunkDeps = {
    index,
    calls,
    linksOf,
    onFollow: follow,
    reviewedHunks,
    onReviewed: setHunkReviewed,
    highlighted: highlight,
    commentsOf,
    openComment,
    onOpenComment: openCommentOn,
    onComment: readOnly ? undefined : writeComment,
    onFocusHunk: focusHunk,
    decisionsOn,
  };
  const before = (
    <>
      {modelOn && analysis.status === "running" && analysis.stages.decisions !== "done" && (
        <p className="muted">Finding the decisions the code makes…</p>
      )}
      {analysis.stages.decisions === "done" &&
        !complete &&
        publication === null &&
        analysis.decisions.length > 0 && (
          <p className="muted">You can give verdicts once the analysis is complete.</p>
        )}
      {places.unplaced.length > 0 && (
        <section className="unplaced-decisions" aria-label="Decisions on no change shown here">
          {places.unplaced.map(card)}
        </section>
      )}
    </>
  );

  const items = useMemo(() => paletteItems(analysis, steps, index), [analysis, steps, index]);
  const pick = (target: PaletteTarget) => {
    setJumping(false);
    switch (target.kind) {
      case "decision":
        return goToDecision(target.decisionId);
      case "mismatch":
        return goToMismatch(target.index);
      case "hunk":
        setHighlight(new Set());
        return showHunk(target.hunkId);
      case "step":
        return goToSection(target.stepId);
      case "mechanical":
        if (layout === "map") goToMechanical();
        return;
    }
  };
  const goFromRail = (target: RailTarget) => {
    if (target.kind === "hunk") return showHunk(target.hunkId);
    if (target.kind === "section") return goToSection(target.key);
    goToMechanical();
  };
  const onInView = useCallback((ids: readonly HunkId[]) => {
    inView.current = ids;
  }, []);

  return (
    <div className={`review-page layout-${layout}`}>
      <ReviewHeader
        view={view}
        intent={
          <IntentLine
            analysis={analysis}
            modelOn={modelOn}
            mismatchAt={mismatchAt}
            onMismatch={goToMismatch}
            onDetails={() => setShowDetails(true)}
          />
        }
        tools={
          <>
            <fieldset className="layout-toggle">
              <legend className="visually-hidden">Layout</legend>
              <button
                type="button"
                className="button"
                aria-pressed={layout === "map"}
                onClick={() => layout !== "map" && switchLayout()}
              >
                Map
              </button>
              <button
                type="button"
                className="button"
                aria-pressed={layout === "tree"}
                onClick={() => layout !== "tree" && switchLayout()}
              >
                Call tree
              </button>
            </fieldset>
            <button type="button" className="button jump-button" onClick={() => setJumping(true)}>
              Jump to… <kbd>⌘K</kbd>
            </button>
            <p className="review-progress" aria-live="polite">
              {reviewedCount} of {toReview.length} {toReview.length === 1 ? "hunk" : "hunks"}{" "}
              reviewed
            </p>
          </>
        }
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
      {verdicts.failure !== null && (
        <div className="banner danger verdict-failure" role="alert">
          <p>
            Couldn't save your {verdicts.failure.what} on “{failureTitle}”.{" "}
            {verdicts.failure.message}
          </p>
          <button type="button" className="button quiet" onClick={verdicts.dismissFailure}>
            Dismiss
          </button>
        </div>
      )}

      {analysis.stages.prep !== "done" ? (
        <section className="main-area" aria-busy={analysis.status === "running"}>
          <p className="muted">
            {analysis.status === "running"
              ? "Reading the diff…"
              : "The diff couldn't be read, so there are no changes to show."}
          </p>
        </section>
      ) : layout === "map" ? (
        <div className="review-body map">
          <MapLayout
            analysis={analysis}
            sections={sections}
            deps={deps}
            contractOnly={contractOnly}
            contractHunks={contractHunks}
            openCalls={openCalls}
            onToggleCall={toggleCall}
            before={before}
            trailingProofs={trailing}
            mechanicalCount={mechanical}
            scrollRequest={scrollRequest}
          />
          <RiskRail
            sections={sections}
            index={index}
            decisionsOn={(id) => restingOn.get(id) ?? NO_DECISIONS}
            totals={totals}
            reviewedHunks={reviewedHunks}
            contractOnly={contractOnly}
            onContractOnly={(value) => setContractOnly(() => value)}
            mechanicalCount={mechanical}
            onGo={goFromRail}
            onInView={onInView}
          />
        </div>
      ) : (
        <div className="review-body tree">
          {places.unplaced.length > 0 && before}
          <TreeLayout
            tree={tree}
            order={inTreeOrder}
            deps={deps}
            selected={treeSelected}
            focus={treeFocus}
            onSelect={(id, from) => selectInTree(id, from)}
            proofs={analysis.proofs}
          />
        </div>
      )}

      <UsageFooter usage={analysis.usage} />

      {publishing && (
        <PublishDialog
          analysisId={analysisId}
          isAuthor={isAuthor}
          pendingCount={pendingCount}
          hunkComments={hunkComments}
          chooseVerdict={analysis.decisions.length === 0}
          onClose={() => setPublishing(false)}
          onPublished={() => {
            setPublishing(false);
            void refetch();
          }}
        />
      )}
      {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
      {jumping && <JumpPalette items={items} onPick={pick} onClose={() => setJumping(false)} />}
      {showDetails && (
        <Dialog
          title={analysis.intent === null ? "What was asked" : "Intent"}
          onClose={() => setShowDetails(false)}
          className="intent-dialog"
        >
          {analysis.intent !== null ? (
            <IntentPanel
              intent={analysis.intent}
              tickets={analysis.tickets}
              missingTicketKeys={analysis.missingTicketKeys}
              onSelectMismatch={(at) => {
                setShowDetails(false);
                goToMismatch(at);
              }}
            />
          ) : (
            analysis.pullRequest !== null && (
              <StatedIntent
                pullRequest={analysis.pullRequest}
                tickets={analysis.tickets}
                missingTicketKeys={analysis.missingTicketKeys}
              />
            )
          )}
        </Dialog>
      )}
      <p className="shortcut-hint muted">
        Press <kbd>?</kbd> for keyboard shortcuts.
      </p>
    </div>
  );
};
