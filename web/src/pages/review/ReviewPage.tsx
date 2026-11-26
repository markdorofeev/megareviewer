import { CircleCheckIcon, Undo2Icon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisView } from "../../../../contracts/index.ts";
import {
  type Hunk,
  hunkIdOf,
  type PartId,
  partHunk,
  type UnchangedCallers,
} from "../../../../src/domain/diff/index.ts";
import {
  type Analysis,
  type AnalysisId,
  HunkComment,
  hasModelRun,
  inProgress,
  MODEL_STAGES,
  modelFamily,
  type Point,
  PointId,
  type PointState,
  PublicationId,
  type PullRequestStatus,
  pointsOf,
  pullRequestUrl,
  type ReviewerVerdict,
  type ReviewThread,
  type ThreadId,
} from "../../../../src/domain/review/index.ts";
import { errorMessage, useAnalysisView, useApi, useMutation, useStatus } from "../../api/index.ts";
import { Link } from "../../app/Link.tsx";
import { navigate, reviewPath } from "../../app/router.ts";
import { holdInView } from "../../lib/held-scroll.ts";
import { type ShortcutHandlers, type ShortcutId, useShortcuts } from "../../lib/keymap.ts";
import { usePageDisplay } from "../../lib/page-display.tsx";
import { type PointTone, pointTone } from "../../lib/status.ts";
import { cn } from "../../lib/utils.ts";
import {
  CallPeek,
  commentPlace,
  createCallPeekHandle,
  DANGER,
  DiffSkeleton,
  FileTree,
  HunkCard,
  KeyHint,
  type LineComment,
  type LinePlace,
  languageOf,
  PINNED,
  type PointLine,
  ReviewThreadView,
  SelectionComment,
  ShortcutsDialog,
  TreeSkeleton,
  threadPlace,
  WARNING,
} from "../../review/index.ts";
import { Button } from "../../ui/button.tsx";
import { Skeleton } from "../../ui/skeleton.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip.tsx";
import type { RuleFields } from "../preferences/PreferenceForm.tsx";
import { scopeOptions, scopePath } from "../preferences/rule.tsx";
import { failureReason } from "../preferences/view.ts";
import { ClaudeElement, type Narrowing } from "./ClaudeElement.tsx";
import { callMarks } from "./calls.tsx";
import { Dialog } from "./Dialog.tsx";
import { FlowBowTie } from "./FlowBowTie.tsx";
import { FlowLanes } from "./FlowLanes.tsx";
import { FlowRows } from "./FlowRows.tsx";
import { flowPaths } from "./flow-paths.ts";
import { DraftGuardrail } from "./Guardrail.tsx";
import { type HunkDeps, hunkAnchor } from "./HunkView.tsx";
import { barButtons, verdictAfter, verdictLabel } from "./header-buttons.ts";
import { IntentLine } from "./IntentLine.tsx";
import { IntentPanel } from "./IntentPanel.tsx";
import { LayoutSwitch } from "./LayoutSwitch.tsx";
import { fileAnchor, MapLayout, MECHANICAL_ANCHOR, type ScrollRequest } from "./MapLayout.tsx";
import { ModelCalls } from "./ModelCalls.tsx";
import {
  changeTotals,
  commentsInParts,
  type Layout,
  mapFiles,
  mechanicalCount,
  OVERVIEW_FORMS,
  openedOn,
  parseOverviewForm,
  partIndex,
  pointPlaces,
  trailingProofs,
} from "./model.ts";
import { useModelChoice } from "./model-choice.ts";
import { Overview } from "./Overview.tsx";
import { fileOverview, type OverviewNode } from "./overview.ts";
import {
  FindingCard,
  type PointActions,
  PointFold,
  PointMention,
  pointAnchor,
} from "./PointCard.tsx";
import { PointList } from "./PointList.tsx";
import { PointStepper } from "./PointStepper.tsx";
import { CODE_STAGES, ProgressStrip, stageName } from "./ProgressStrip.tsx";
import { PublishDialog } from "./PublishDialog.tsx";
import { Rail } from "./Rail.tsx";
import { RemoveModelRun } from "./RemoveModelRun.tsx";
import { RepositoryStatus } from "./RepositoryStatus.tsx";
import { RerunModel } from "./RerunModel.tsx";
import { ReviewBar } from "./ReviewBar.tsx";
import { ReviewHeader } from "./ReviewHeader.tsx";
import { StatedIntent } from "./StatedIntent.tsx";
import { narrowTo } from "./stepper.ts";
import { parseBoolean, readSession, useStoredState, writeSession } from "./storage.ts";
import { ThreadList, ThreadStepper, threadChip } from "./ThreadStepper.tsx";
import { type ThreadScope, threadOrder, threadScopeOf, threadSteps } from "./thread-steps.ts";
import { coveredLines, placeKey, placeThreads, threadAnchor } from "./threads.ts";
import { noTourOf, type TourExcerpt, type TourStep, tourOf } from "./tour.ts";
import { TOUR_LANDING, TourLanding, Understand } from "./Understand.tsx";
import { UsageFooter } from "./UsageFooter.tsx";
import { useFileInView } from "./useFileInView.ts";
import { useHarness } from "./useHarness.ts";
import { useLanding } from "./useLanding.ts";
import { cameFrom, useLayout } from "./useLayout.ts";
import { useMarksHeld } from "./useMarksHeld.ts";
import { usePoints } from "./usePoints.ts";
import { usePullRequestStatus } from "./usePullRequestStatus.ts";
import { useThreads } from "./useThreads.ts";

const NO_COMMENTS: readonly HunkComment[] = [];
const parseHunkComments = (stored: unknown): readonly HunkComment[] | undefined =>
  HunkComment.array().safeParse(stored).data;

export const ReviewPage = ({ analysisId }: { readonly analysisId: AnalysisId }) => {
  // A retry, or a re-analysis of an unchanged PR, runs again under the same ID. A new run starts
  // the page afresh, so it follows the new run's events; one whose view is in hand starts from it.
  const [run, setRun] = useState<{ readonly count: number; readonly seed: AnalysisView | null }>({
    count: 0,
    seed: null,
  });
  const restart = useCallback(
    (seed: AnalysisView | null = null) => setRun(({ count }) => ({ count: count + 1, seed })),
    [],
  );
  return (
    <ReviewLoader
      key={`${analysisId}/${run.count}`}
      analysisId={analysisId}
      seed={run.seed}
      restart={restart}
    />
  );
};

const ReviewLoader = ({
  analysisId,
  seed,
  restart,
}: {
  readonly analysisId: AnalysisId;
  readonly seed: AnalysisView | null;
  readonly restart: (seed?: AnalysisView | null) => void;
}) => {
  const { view, error, refetch, follow } = useAnalysisView(analysisId, seed);
  if (view === null) {
    if (error?.code === "not-found") {
      return (
        <div className="mx-auto flex max-w-2xl flex-col gap-3 py-12">
          <h1 className="text-title font-semibold tracking-[-0.01em]">Analysis not found</h1>
          <p className="text-body">{errorMessage(error)}</p>
          <p>
            <Link to="/">Pick a pull request to review</Link>
          </p>
        </div>
      );
    }
    if (error !== null) {
      return (
        <div className="mx-auto flex max-w-2xl flex-col items-start gap-3 py-12">
          <p className={DANGER} role="alert">
            Couldn't load the analysis. {errorMessage(error)}
          </p>
          <Button variant="outline" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      );
    }
    return <ReviewSkeleton />;
  }
  return <Review view={view} refetch={refetch} follow={follow} restart={restart} />;
};

const ReviewSkeleton = () => (
  <div
    className="mx-auto flex max-w-[1600px] flex-col gap-4"
    role="status"
    aria-busy="true"
    aria-label="Loading the analysis"
  >
    <Skeleton className="h-7 w-2/3" />
    <Skeleton className="h-4 w-1/2" />
    <div className={MAP_GRID}>
      <TreeSkeleton />
      <DiffSkeleton />
    </div>
  </div>
);

/** The map's two columns: the rail beside the code, or only the code at 1024px or less. */
const MAP_GRID = "grid items-start gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]";

const NO_POINTS: readonly Point[] = [];

/** What the code was opened from: the overview on a node, or the tour on a step. */
type ReturnTo =
  | { readonly kind: "overview"; readonly node: string | null }
  | { readonly kind: "tour"; readonly step: number };

/** The shortcuts the review page has, for its `?` dialog. */
const PAGE_SHORTCUTS: readonly ShortcutId[] = [
  "nextFile",
  "previousFile",
  "comment",
  "openCall",
  "moveFile",
  "openFile",
  "toggleLayout",
  "openReview",
  "close",
  "help",
];
const NO_UNCHANGED: readonly UnchangedCallers[] = [];

/**
 * The analysis the page shows: the live one, except while Claude runs, when it stays as it was
 * before, so nothing in the code moves until everything that will land has arrived.
 */
const useSettled = (live: Analysis, running: boolean): Analysis => {
  const [held, setHeld] = useState(live);
  if (!running && held !== live) setHeld(live);
  return running ? held : live;
};

/**
 * The "side:line" of the last of a point's lines a part shows, which its card goes under, and
 * how many rows from its first line down to it.
 */
const lastLineShown = (point: Point, hunk: Hunk): { key: string; rows: number } | null => {
  const { lines } = point;
  if (lines === null) return null;
  let first: number | null = null;
  let last: { line: number; at: number } | null = null;
  for (const [at, one] of hunk.lines.entries()) {
    const place = commentPlace(one);
    if (place === null || place.side !== lines.side) continue;
    if (place.line < lines.startLine || place.line > lines.line) continue;
    first ??= at;
    if (last === null || place.line > last.line) last = { line: place.line, at };
  }
  return first === null || last === null
    ? null
    : { key: `${lines.side}:${last.line}`, rows: last.at - first + 1 };
};

/** Bitbucket can't anchor a comment on a range of lines. */
const RANGE_NOTES = {
  github: undefined,
  bitbucket: "Bitbucket can't anchor a range, so the comment goes on the last line and names them.",
} as const;

// A number per analysis object, so a hunk's signature changes when the analysis does.
const epochs = new WeakMap<object, number>();
let lastEpoch = 0;
const epochOf = (analysis: object): number => {
  const known = epochs.get(analysis);
  if (known !== undefined) return known;
  lastEpoch += 1;
  epochs.set(analysis, lastEpoch);
  return lastEpoch;
};

const Review = ({
  view,
  refetch,
  follow,
  restart,
}: {
  readonly view: AnalysisView;
  readonly refetch: () => Promise<void>;
  readonly follow: () => void;
  readonly restart: (seed?: AnalysisView | null) => void;
}) => {
  const { client } = useApi();
  const { status } = useStatus();
  const modelChoice = useModelChoice(status?.model ?? null);
  const { analysis: live, publication } = view;
  const analysisId = live.id;
  const complete = live.status === "complete";
  // Claude's passes, running on the complete analysis since the reviewer asked for them.
  const modelRunning = complete && inProgress(live);
  // The code, the tree and the receipt stay as they were until Claude's run ends; only the
  // header follows it.
  // A guardrail call's marks, after the landing, don't move the code being read either.
  const analysis = useMarksHeld(useSettled(live, modelRunning));
  const runModel = useMutation(client.runModel);
  const readOnly = publication !== null || !complete;

  const index = useMemo(() => partIndex(analysis), [analysis]);
  const files = useMemo(() => mapFiles(analysis, index), [analysis, index]);
  const order = useMemo(() => files.flatMap((group) => group.partIds), [files]);
  const trailing = useMemo(() => trailingProofs(analysis, index), [analysis, index]);
  const mechanical = mechanicalCount(trailing);
  // On until the reviewer turns it off: off, a run asks for no tour and there's no Tour layout.
  const [tourOn, setTourOn] = useStoredState("tour", true, parseBoolean);
  const points = useMemo(() => pointsOf(analysis), [analysis]);
  const pointIds = useMemo(() => points.map((point) => point.id), [points]);
  const pointStates = usePoints(analysisId, view.pointReviews);
  // A point a preference says not to flag is folded where its card would be until the reviewer
  // shows it or has acted on it: it's no step, counts in no chip and marks no line.
  const [shownLeftOut, setShownLeftOut] = useState<ReadonlySet<PointId>>(new Set());
  const { stateOf } = pointStates;
  const folded = useMemo(
    () =>
      new Set(
        points
          .filter(
            (point) =>
              point.guidance?.effect === "left-out" &&
              stateOf(point.id) === "open" &&
              !shownLeftOut.has(point.id),
          )
          .map((point) => point.id),
      ),
    [points, stateOf, shownLeftOut],
  );
  /** The points the stepper walks and the chips count. */
  const walked = useMemo(() => points.filter((point) => !folded.has(point.id)), [points, folded]);
  const showLeftOut = useCallback(
    (id: PointId) => setShownLeftOut((previous) => new Set(previous).add(id)),
    [],
  );
  const family = modelFamily(live.modelOption ?? modelChoice.chosen);
  const landing = useLanding(modelRunning, pointIds, family);
  const places = useMemo(() => pointPlaces(points, order, index), [points, order, index]);
  // Where each point goes on its part: under the last of its lines the part shows. A point whose
  // lines the part doesn't show goes under its header.
  const cardPlaces = useMemo(() => {
    const underLine = new Map<PartId, Map<string, Point[]>>();
    const underHeader = new Map<PartId, Point[]>();
    const rowsAbove = new Map<PointId, number>();
    for (const [partId, placed] of places.cards) {
      const part = index.parts.get(partId);
      for (const point of placed) {
        const last = part === undefined ? null : lastLineShown(point, part.hunk);
        if (last === null) {
          underHeader.set(partId, [...(underHeader.get(partId) ?? []), point]);
        } else {
          const lines = underLine.get(partId) ?? new Map<string, Point[]>();
          lines.set(last.key, [...(lines.get(last.key) ?? []), point]);
          underLine.set(partId, lines);
          rowsAbove.set(point.id, last.rows);
        }
      }
    }
    return { underLine, underHeader, rowsAbove };
  }, [places, index]);
  // Points that share a fold land with its first: the fold is what's measured and unfolds.
  const foldOf = useMemo(() => {
    const first = new Map<PointId, PointId>();
    const share = (together: readonly Point[]) => {
      const [lead] = together;
      for (const point of together) if (lead !== undefined) first.set(point.id, lead.id);
    };
    for (const lines of cardPlaces.underLine.values())
      for (const here of lines.values()) share(here);
    for (const [partId, here] of cardPlaces.underHeader) {
      share([...here, ...(places.mentions.get(partId) ?? NO_POINTS)]);
    }
    for (const [partId, mentions] of places.mentions) {
      if (!cardPlaces.underHeader.has(partId)) share(mentions);
    }
    share(places.unplaced);
    return first;
  }, [cardPlaces, places]);
  const { inView } = landing;
  const landingAt = useCallback(
    (id: PointId): number | undefined => inView.get(foldOf.get(id) ?? id),
    [inView, foldOf],
  );
  // Each file's findings, for the tree's marks.
  const findingsByFile = useMemo(() => {
    const byPath = new Map<string, number>();
    for (const [partId, placed] of places.cards) {
      const path = index.parts.get(partId)?.file.path;
      if (path === undefined) continue;
      const counted = placed.filter((point) => !folded.has(point.id)).length;
      if (counted > 0) byPath.set(path, (byPath.get(path) ?? 0) + counted);
    }
    return byPath;
  }, [places, index, folded]);
  const treeFiles = useMemo(
    () =>
      files.map(({ file }) => ({
        path: file.path,
        status: file.status,
        oldPath: file.oldPath,
        additions: file.additions,
        deletions: file.deletions,
        findings: findingsByFile.get(file.path) ?? 0,
      })),
    [files, findingsByFile],
  );
  // Directories the reviewer opened in the overview, to see their files.
  const [expandedGroups, setExpandedGroups] = useState<readonly string[]>([]);
  const overview = useMemo(
    () => fileOverview(analysis, new Set(expandedGroups)),
    [analysis, expandedGroups],
  );
  // With the Tour switch on and a tour, the Tour layout is Understand. The tour is drawn from the
  // analysis shown; whether it's being written, from the live one.
  const tourOverview = useMemo(() => fileOverview(analysis), [analysis]);
  const noTour = tourOn ? noTourOf(live) : null;
  const tour = useMemo(
    () => (tourOn ? tourOf(analysis, tourOverview, points) : null),
    [tourOn, analysis, tourOverview, points],
  );

  const tourReady = tourOn && noTour === null && tour !== null;
  const [layout, setLayout] = useLayout(tourReady);
  // The overview as its directories, or as one of the previews of the pull request's flow paths.
  const [overviewForm, setOverviewForm] = useStoredState(
    "overview-form",
    "directories",
    parseOverviewForm,
  );
  const flow = useMemo(
    () => (overviewForm === "directories" ? null : flowPaths(analysis)),
    [overviewForm, analysis],
  );
  // The directories the bow tie shows as their files, and the cells the lanes show whole.
  const [flowOpened, setFlowOpened] = useState<ReadonlySet<string>>(new Set());
  const toggleFlow = (key: string) =>
    setFlowOpened((previous) => {
      const next = new Set(previous);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const understand = layout === "tour";
  const filePaths = useMemo(() => files.map((group) => group.file.path), [files]);
  const fileInView = useFileInView(filePaths, layout === "map" && analysis.stages.prep === "done");
  // At 1024px or less the rail is behind a button.
  const [railOpen, setRailOpen] = useState(false);
  const unchanged = useMemo(() => {
    const byPart = new Map<PartId, UnchangedCallers[]>();
    for (const one of analysis.unchangedCallers) {
      byPart.set(one.partId, [...(byPart.get(one.partId) ?? []), one]);
    }
    return byPart;
  }, [analysis.unchangedCallers]);
  const unchangedOf = useCallback((id: PartId) => unchanged.get(id) ?? NO_UNCHANGED, [unchanged]);
  // One card for every call on the page, carrying the code of the call under the pointer.
  const [callPeek] = useState(createCallPeekHandle);
  const calls = useMemo(
    () => callMarks(analysis.callSites, index, callPeek),
    [analysis.callSites, index, callPeek],
  );
  const marksOf = useCallback((id: PartId) => calls.get(id), [calls]);
  const [focusedHunkId, setFocusedHunkId] = useState<PartId | null>(null);
  // The file the overview asks to focus, and the node last focused there.
  const [overviewFocus, setOverviewFocus] = useState<{ key: string; n: number } | null>(null);
  const overviewAt = useRef<string | null>(null);
  // What the code was opened from, for Back to come back to: the overview, on the node to focus
  // there, or the tour, on its step.
  const [returnTo, setReturnTo] = useState<ReturnTo | null>(null);
  const [currentPoint, setCurrentPoint] = useState<PointId | null>(null);
  // What a pressed chip has the stepper walk.
  const [narrowed, setNarrowed] = useState<Narrowing | null>(null);
  // The thread last gone to, and what the stepper goes round of them.
  const [currentThread, setCurrentThread] = useState<ThreadId | null>(null);
  const [threadScopeChosen, setThreadScope] = useState<ThreadScope | null>(null);
  const [resolvedHere, setResolvedHere] = useState<ReadonlySet<ThreadId>>(new Set());
  const [showThreads, setShowThreads] = useState(false);
  // The stepper walks the threads when their chip is pressed, or when Claude has no points.
  const walkingThreads = narrowed === "thread" || walked.length === 0;
  // A run again may find none of the type a chip narrowed the stepper to.
  const walkedType =
    narrowed !== "thread" && walked.some((point) => point.type === narrowed) ? narrowed : null;
  // One thing on the page is the current one: the point or the thread the stepper is on.
  const activePoint = walkingThreads ? null : currentPoint;
  const [showPoints, setShowPoints] = useState(false);
  // When this page saw Claude's run start, for the time since.
  const [rerunning, setRerunning] = useState(false);
  // The hunks of a point the reviewer went to.
  const [highlight, setHighlight] = useState<ReadonlySet<PartId>>(new Set());
  const [scrollRequest, setScrollRequest] = useState<ScrollRequest | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const detailsReturnFocus = useRef(true);
  const [showDetails, setShowDetails] = useState(false);
  // Comments on hunk lines are drafts in this browser until they're published with the review.
  const [hunkComments, setHunkComments] = useStoredState(
    `hunk-comments:${analysisId}`,
    NO_COMMENTS,
    parseHunkComments,
  );
  const [openComment, setOpenComment] = useState<{ partId: PartId; place: LinePlace } | null>(null);
  /**
   * What a point's Comment or Edit changed before opening the box, which Cancel puts back: the
   * draft that was on its lines, if any, and the point's state.
   */
  const raised = useRef<{
    partId: PartId;
    place: LinePlace;
    before: HunkComment | undefined;
    pointId: PointId;
    state: PointState;
  } | null>(null);
  // A comment shows in the part that holds its line.
  const commentsByPart = useMemo(() => commentsInParts(hunkComments, index), [hunkComments, index]);
  const commentsOf = useCallback(
    (id: PartId): readonly HunkComment[] => commentsByPart.get(id) ?? NO_COMMENTS,
    [commentsByPart],
  );
  const writeComment = useCallback(
    (id: PartId, comment: LineComment) =>
      setHunkComments((previous) => {
        const hunkId = hunkIdOf(id);
        const same = (other: HunkComment) =>
          other.hunkId === hunkId && other.side === comment.side && other.line === comment.line;
        const written = { hunkId, ...comment };
        // A draft with nothing in it is removed; a suggestion is something.
        const empty = comment.body === "" && comment.suggestion === undefined;
        if (!previous.some(same)) return empty ? previous : [...previous, written];
        return empty
          ? previous.filter((other) => !same(other))
          : previous.map((other) => (same(other) ? written : other));
      }),
    [setHunkComments],
  );
  const latestComments = useRef(hunkComments);
  latestComments.current = hunkComments;
  const openCommentOn = useCallback(
    (partId: PartId, place: LinePlace | null) => {
      raised.current = null;
      setOpenComment((previous) => {
        if (place === null) return null;
        const hunkId = hunkIdOf(partId);
        const open = previous?.partId === partId ? previous.place : null;
        setHunkComments((comments) => openedOn(comments, hunkId, place, open).comments);
        return { partId, place: openedOn(latestComments.current, hunkId, place, open).place };
      });
    },
    [setHunkComments],
  );

  const { setState: setPointState } = pointStates;
  const cancelComment = useCallback(
    (partId: PartId, place: LinePlace) => {
      const undo = raised.current;
      raised.current = null;
      if (undo === null || undo.partId !== partId || undo.place.side !== place.side) return;
      if (undo.place.line !== place.line) return;
      writeComment(partId, undo.before ?? { ...undo.place, body: "" });
      if (undo.state !== "raised") void setPointState(undo.pointId, undo.state);
    },
    [writeComment, setPointState],
  );

  // The host's conversation on the code, read live, beside the analysis.
  const threads = useThreads(analysisId, analysis.stages.prep === "done");
  const prStatus = usePullRequestStatus(analysisId);
  const harness = useHarness(analysisId);
  const { post } = threads;
  const postCommentNow = useCallback(
    (id: PartId, comment: LineComment) => post({ hunkId: hunkIdOf(id), ...comment }),
    [post],
  );
  const placement = useMemo(
    () => placeThreads(threads.list?.threads ?? null, files, index),
    [threads.list, files, index],
  );
  const orderedThreads = useMemo(
    () => threadOrder(placement, files, index),
    [placement, files, index],
  );
  const threadScope = threadScopeOf(threadScopeChosen, orderedThreads, resolvedHere);
  const activeThread = walkingThreads ? currentThread : null;
  const { resolve } = threads;
  const resolveThread = useCallback(
    async (id: ThreadId, resolved: boolean) => {
      const error = await resolve(id, resolved);
      // A thread resolved here stays a step, so the stepper's position doesn't jump.
      if (error === null && resolved) setResolvedHere((previous) => new Set(previous).add(id));
      return error;
    },
    [resolve],
  );
  const authorId = analysis.pullRequest?.author.id ?? null;
  const threadView = (thread: ReviewThread, covered: readonly string[] | null) => (
    <ReviewThreadView
      key={thread.id}
      thread={thread}
      authorId={authorId}
      now={Date.now()}
      language={languageOf({ path: thread.path, language: null })}
      covered={covered}
      mediaUrl={(url) => client.attachmentUrl(analysisId, url)}
      onReply={(body) => threads.reply(thread.id, body)}
      onResolve={(resolved) => resolveThread(thread.id, resolved)}
      current={activeThread === thread.id}
      anchorId={threadAnchor(thread.id)}
      linesAbove={covered?.length ?? 0}
    />
  );
  const threadsAt = (id: PartId, place: LinePlace): ReactNode => {
    const here = placement.onLine.get(id)?.get(placeKey(place));
    if (here === undefined) return null;
    const hunk = index.parts.get(id)?.hunk;
    return here.map((thread) => {
      const start = thread.startLine ?? place.line;
      return threadView(
        thread,
        hunk === undefined ? null : coveredLines(hunk, Math.min(start, place.line), place.line),
      );
    });
  };
  const earlierThreads = (path: string): ReactNode => {
    const earlier = placement.earlier.get(path);
    if (earlier === undefined) return null;
    return earlier.map((thread) => (
      <div key={thread.id} className="flex flex-col gap-1">
        <span className="text-caption text-muted-foreground">
          {thread.outdated
            ? `Was on ${thread.side === "old" ? "old " : ""}line ${thread.originalLine ?? "?"}; the code has changed since`
            : `On ${threadPlace(thread)}, which the diff doesn't show`}
        </span>
        {threadView(thread, null)}
      </div>
    ));
  };
  const openThreads = (path: string) => placement.open.get(path) ?? 0;
  const treeWithThreads = useMemo(
    () => treeFiles.map((file) => ({ ...file, threads: placement.open.get(file.path) ?? 0 })),
    [treeFiles, placement],
  );

  const scrollTo = (id: string) =>
    setScrollRequest((previous) => ({ id, n: (previous?.n ?? 0) + 1 }));
  /** The part the reviewer is on: the one last focused in the map. */
  const currentHunk = (): PartId | null => (layout === "map" ? focusedHunkId : null);

  const focusHunk = useCallback((id: PartId) => setFocusedHunkId(id), []);
  /** Focuses a file's place in the overview: its directory, its node, or a node it's a badge on. */
  const focusInOverview = (path: string) => {
    if (!overview.placeOf.has(path)) return;
    setOverviewFocus((previous) => ({ key: path, n: (previous?.n ?? 0) + 1 }));
  };
  /** Shows a hunk: scrolls to it in the map, focuses its file in the overview. */
  const showHunk = (id: PartId, inLayout: Layout = layout) => {
    if (inLayout === "overview") {
      const path = index.parts.get(id)?.file.path;
      if (path !== undefined) focusInOverview(path);
      return;
    }
    scrollTo(order.includes(id) ? hunkAnchor(id) : MECHANICAL_ANCHOR);
  };
  const goToPoint = (id: PointId) => {
    const point = points.find((one) => one.id === id);
    const cardPart = places.cardPart.get(id);
    // Going to a point a preference left out shows it.
    if (folded.has(id)) showLeftOut(id);
    // The stepper stays on what was gone to.
    setNarrowed((narrowing) => (narrowing === point?.type ? narrowing : null));
    setHighlight(new Set((point?.hunkIds ?? []).flatMap(index.partsOf)));
    if (layout === "overview") {
      if (cardPart !== undefined) showHunk(cardPart);
    } else {
      // The tour has no point cards: its points open the map.
      toCode();
      scrollTo(pointAnchor(id));
    }
    setCurrentPoint(id);
  };
  // The tour's place across the layouts: the step the map was opened from, which the map marks and
  // Back goes back to, and the step last current, kept per analysis in the tab.
  const [fromStep, setFromStep] = useState<{
    readonly step: TourStep;
    readonly excerpt: TourExcerpt;
  } | null>(null);
  const [landOn, setLandOn] = useState<{
    readonly step: number;
    readonly n: number;
    readonly inPlace?: boolean;
  } | null>(null);
  // Cards above a step's lines take their size after the map scrolled to it: hold it in place.
  const [landingHeld, setLandingHeld] = useState(0);
  useEffect(() => {
    if (landingHeld === 0 || layout !== "map") return;
    return holdInView(TOUR_LANDING, "[aria-label=Changes]");
  }, [landingHeld, layout]);
  const storedStepKey = `tour-step:${analysisId}`;
  const readStoredStep = (): number => {
    const stored = readSession(storedStepKey);
    return typeof stored === "number" ? stored : 0;
  };
  /**
   * To the code from the overview or the tour, on a history entry of its own that Back, Esc and
   * the switch go back from; nothing while the code is shown.
   */
  const toCode = (
    from: ReturnTo = understand
      ? { kind: "tour", step: readStoredStep() }
      : { kind: "overview", node: overviewAt.current },
  ) => {
    if (layout === "map") return;
    setLayout("map", { from: layout });
    setReturnTo(from);
  };
  /** Whether the code was opened from the overview or the tour, which Back goes back to. */
  const openedFrom = (): Layout | null => {
    const came = cameFrom();
    return came?.from === "overview" || came?.from === "tour" ? came.from : null;
  };
  /** Back to the overview or the tour the code was opened from, as the reader left it. */
  const backFromCode = () => {
    if (openedFrom() !== null) window.history.back();
  };
  // Back on the overview or the tour, however: the node or the step the code was opened from takes
  // the focus again, and the code's marks of where it was opened from go.
  const shownLayout = useRef(layout);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the layout changes.
  useEffect(() => {
    if (shownLayout.current === layout) return;
    shownLayout.current = layout;
    if (layout === "map") return;
    if (returnTo?.kind === "overview" && returnTo.node !== null) {
      const node = returnTo.node;
      setOverviewFocus((previous) => ({ key: node, n: (previous?.n ?? 0) + 1 }));
    }
    if (returnTo?.kind === "tour") {
      const { step } = returnTo;
      setLandOn((previous) => ({ step, n: (previous?.n ?? 0) + 1, inPlace: true }));
    }
    setReturnTo(null);
    setFromStep(null);
    setHighlight(new Set());
  }, [layout]);
  /** The tour on step `step`, or at its top for 0. */
  const enterTour = (step: number) => {
    setReturnTo(null);
    setLayout("tour", layout === "map" ? { from: "code", step } : null);
    setLandOn((previous) => ({ step, n: (previous?.n ?? 0) + 1 }));
  };
  /** The map on an excerpt's lines, marked, under a label naming its step. */
  const openInCode = (step: TourStep, excerpt: TourExcerpt) => {
    toCode({ kind: "tour", step: step.number });
    setFromStep({ step, excerpt });
    setFocusedHunkId(excerpt.partId);
    writeSession(storedStepKey, step.number);
    // The label over the excerpt, which can start well below its part's top.
    scrollTo(TOUR_LANDING);
    setLandingHeld((previous) => previous + 1);
  };
  const openFileFromTour = (path: string) => {
    toCode(understand ? undefined : { kind: "overview", node: path });
    scrollTo(
      files.some((group) => group.file.path === path) ? fileAnchor(path) : MECHANICAL_ANCHOR,
    );
  };
  /**
   * Goes to a thread in the map, from the overview too, since the overview doesn't show threads:
   * scrolls it under the bar, opens it if it's folded, and gives it the focus.
   */
  const goToThread = (id: ThreadId) => {
    setNarrowed("thread");
    setCurrentThread(id);
    setHighlight(new Set());
    toCode();
    scrollTo(threadAnchor(id));
  };
  /** Has the stepper walk a type's findings or the threads, going to the first unless on one. */
  const narrow = (kind: Narrowing | null) => {
    setNarrowed(kind);
    if (kind === "thread") {
      const steps = threadSteps(orderedThreads, threadScope, resolvedHere);
      const [first] = steps;
      if (first !== undefined && !steps.some((thread) => thread.id === currentThread)) {
        goToThread(first.id);
      }
      return;
    }
    const to = narrowTo(walked, kind, currentPoint);
    if (to !== null) goToPoint(to);
  };
  /**
   * A mismatch is one of Claude's points, the nth of the intent's, so Details goes to its card:
   * its own, or the finding that shows it.
   */
  const goToMismatch = (at: number) => {
    const id = PointId.parse(`m${at + 1}`);
    const shows = analysis.findings.find((finding) => finding.mismatch === `m${at + 1}`);
    goToPoint(
      points.some((point) => point.id === id) || shows === undefined ? id : PointId.parse(shows.id),
    );
  };
  /** The overview opens on the file the reviewer is on: the card holding the focus, else in view. */
  const openOverview = () => {
    const focused = document.activeElement?.closest<HTMLElement>(
      "[aria-label=Changes] [data-slot=file-card]",
    );
    const path = focused?.dataset.path ?? fileInView;
    const at = path === null ? null : (overview.placeOf.get(path) ?? path);
    // Where it opens, whether or not the focus gets there: a hidden tab reports no focus.
    overviewAt.current = at;
    setReturnTo(null);
    setLayout("overview", { from: "code", at });
    if (path !== null) focusInOverview(path);
  };
  /** Opens a directory's or a file's first file in the map. */
  const openNode = (node: OverviewNode) => {
    const [path] = node.paths;
    const first = files.find((group) => group.file.path === path)?.partIds[0];
    if (path === undefined || first === undefined) return;
    toCode({ kind: "overview", node: node.key });
    setFocusedHunkId(first);
    scrollTo(fileAnchor(path));
  };
  /** Opens a part from a flow path in the map; Esc comes back to its file's stop. */
  const openFlowPart = (id: PartId, path: string | null) => {
    toCode({ kind: "overview", node: path ?? index.parts.get(id)?.file.path ?? null });
    setFocusedHunkId(id);
    showHunk(id, "map");
  };
  const switchLayout = () => {
    if (layout === "map") {
      // Opened from the overview or the tour: back to it, as the reader left it.
      if (openedFrom() !== null) return window.history.back();
      // With a tour, to the step last current; else the overview, on the file in view.
      if (tourReady) return enterTour(readStoredStep());
      return openOverview();
    }
    // Opened from the code and not moved since: back to the very line the reader left.
    const came = cameFrom();
    if (came?.from === "code") {
      const unmoved =
        "step" in came
          ? understand && came.step === readStoredStep()
          : !understand && (flow !== null || came.at === overviewAt.current);
      if (unmoved) return window.history.back();
    }
    if (understand) {
      // To the current step's lines, as its Open in code.
      const step = tour?.steps.find((one) => one.number === readStoredStep());
      const [excerpt] = step?.excerpts ?? [];
      if (step !== undefined && excerpt !== undefined) return openInCode(step, excerpt);
      return toCode();
    }
    const node = [...overview.rows.flat(), ...overview.strip].find(
      (one) => one.key === overviewAt.current,
    );
    if (node !== undefined) return openNode(node);
    toCode();
  };
  /** The layout the bar's switch chose: from the code, back to the one it was opened from. */
  const chooseLayout = (next: Layout) => {
    if (next === layout) return;
    if (next === "map") return switchLayout();
    if (layout === "map" && openedFrom() === next) return window.history.back();
    if (next === "tour") return enterTour(readStoredStep());
    if (layout === "map") return openOverview();
    setReturnTo(null);
    setLayout("overview");
  };
  usePageDisplay({
    toggles: [{ label: "Tour (preview)", checked: tourOn, onChange: (on) => setTourOn(() => on) }],
    more: {
      label: "Overview (preview)",
      options: OVERVIEW_FORMS,
      value: overviewForm,
      onChange: (next) => setOverviewForm((previous) => parseOverviewForm(next) ?? previous),
    },
  });

  /**
   * Goes to the next or previous file's card: from the card holding the focus, or else from where
   * the window is scrolled to.
   */
  const moveFile = (direction: 1 | -1) => {
    const cards = [
      ...document.querySelectorAll<HTMLElement>("[aria-label=Changes] [data-slot=file-card]"),
    ];
    const focused = cards.findIndex((card) => card.contains(document.activeElement));
    const target =
      focused !== -1
        ? cards[focused + direction]
        : direction === 1
          ? cards.find((card) => card.getBoundingClientRect().top > 1)
          : cards.findLast((card) => card.getBoundingClientRect().top < -1);
    if (target !== undefined) scrollTo(target.id);
  };

  /**
   * Raises a point: a comment on its lines with its text and its suggestion, which
   * posts with the review under their name. With `add` it's saved as it is; otherwise the comment
   * box opens on it for the reviewer to edit. A draft already on those lines keeps what's in it:
   * the point's text goes after it, or, raised before, the draft opens as the reviewer left it.
   */
  const raisePoint = (point: Point, add = false) => {
    const partId = places.cardPart.get(point.id);
    const found = partId === undefined ? undefined : index.parts.get(partId);
    if (readOnly || partId === undefined || found === undefined) return;
    const fromLines =
      point.lines === null
        ? null
        : {
            side: point.lines.side,
            line: point.lines.line,
            ...(point.lines.startLine === point.lines.line
              ? {}
              : { startLine: point.lines.startLine }),
          };
    const firstChanged = found.hunk.lines.find((one) => one.kind !== "context");
    const place = fromLines ?? (firstChanged === undefined ? null : commentPlace(firstChanged));
    if (place === null) return;
    const text = point.explanation === "" ? point.title : `${point.title}\n\n${point.explanation}`;
    const hunkId = hunkIdOf(partId);
    const draft = hunkComments.find(
      (comment) =>
        comment.hunkId === hunkId && comment.side === place.side && comment.line === place.line,
    );
    const extras = {
      ...(point.suggestion === null ? {} : { suggestion: point.suggestion }),
    };
    if (draft === undefined) {
      writeComment(partId, { ...place, body: text, ...extras });
    } else if (pointStates.stateOf(point.id) !== "raised" && !draft.body.includes(text)) {
      writeComment(partId, {
        ...extras,
        ...draft,
        body: draft.body === "" ? text : `${draft.body}\n\n${text}`,
      });
    }
    setCurrentPoint(point.id);
    const state = pointStates.stateOf(point.id);
    void pointStates.setState(point.id, "raised");
    if (add) return;
    const { startLine } = draft ?? place;
    const opened = {
      side: place.side,
      line: place.line,
      ...(startLine === undefined ? {} : { startLine }),
    };
    setOpenComment({ partId, place: opened });
    raised.current = { partId, place: opened, before: draft, pointId: point.id, state };
    scrollTo(hunkAnchor(partId));
  };
  const commentOnFocused = () => {
    // Comment on the focused hunk's first changed line.
    const current = currentHunk();
    const found = current === null ? undefined : index.parts.get(current);
    const line = found?.hunk.lines.find((one) => one.kind !== "context");
    if (!complete || found === undefined || line === undefined) return;
    const place = commentPlace(line);
    if (place === null || current === null) return;
    raised.current = null;
    setOpenComment({ partId: current, place });
  };
  /**
   * Opens the code a call runs: the call after the open one on the focused line, or the first,
   * or else on the focused part or file.
   */
  const openCallOnFocused = () => {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement)) return;
    const scope =
      focused.closest("[role=row]") ??
      focused.closest("[data-slot=hunk-card]") ??
      focused.closest("[data-slot=file-card]");
    const found = [...(scope?.querySelectorAll<HTMLElement>("[data-slot=call]") ?? [])];
    const open = found.findIndex((call) => call.hasAttribute("data-popup-open"));
    const next = found[(open + 1) % found.length];
    if (next !== undefined) callPeek.open(next.id);
  };
  const onEscape = () => {
    if (highlight.size > 0) return setHighlight(new Set());
    if (layout === "map") backFromCode();
  };
  // The verdict is the reviewer's own, so a complete analysis can always be published.
  const canPublish = complete;
  // The overview handles its own arrows and Enter, on the file that has the focus.
  const mapOnly: ShortcutHandlers = {
    nextFile: () => moveFile(1),
    previousFile: () => moveFile(-1),
    comment: commentOnFocused,
    openCall: openCallOnFocused,
    close: onEscape,
  };
  useShortcuts(
    {
      ...(layout === "map" ? mapOnly : {}),
      toggleLayout: () => switchLayout(),
      openReview: () => {
        if (canPublish) void openPublish();
      },
      help: () => setShowShortcuts(true),
    },
    !publishing && !showShortcuts && !showDetails,
  );

  const prUrl = analysis.pullRequest?.url ?? pullRequestUrl(analysis.key.ref);
  const reanalyze = useMutation(client.startAnalysis);
  const retry = useMutation(client.retryAnalysis);
  const open = (id: AnalysisId) => {
    if (id === analysisId) restart();
    else navigate(reviewPath(id));
  };

  const openPublish = () => setPublishing(true);
  // The reviewer's verdict on the host, so an approval given on the host's own page counts too.
  // What they just did here stands until the status read after it answers, so the bar follows the
  // click rather than the read, which can fail.
  const [justDid, setJustDid] = useState<{
    readonly verdict: ReviewerVerdict | null;
    readonly over: PullRequestStatus | null;
  } | null>(null);
  const latestStatus = useRef(prStatus.status);
  latestStatus.current = prStatus.status;
  const hostVerdict =
    view.currentUserId === null
      ? null
      : (prStatus.status?.reviewers.find((reviewer) => reviewer.id === view.currentUserId)
          ?.verdict ?? null);
  const fresh = justDid !== null && justDid.over === prStatus.status;
  const yourVerdict = fresh ? justDid.verdict : hostVerdict;
  const verdictKnown = fresh || (prStatus.status !== null && view.currentUserId !== null);
  const did = (verdict: ReviewerVerdict | null) => {
    setJustDid({ verdict, over: latestStatus.current });
    prStatus.reload();
  };
  // Approve posts the verdict alone. Its ID stays until the host answers, so a retry after a lost
  // answer doesn't approve twice.
  const approve = useMutation(client.publish);
  const approveId = useRef<PublicationId | null>(null);
  const approveNow = async () => {
    approveId.current ??= PublicationId.parse(crypto.randomUUID());
    const result = await approve.run(analysisId, {
      publicationId: approveId.current,
      summary: "",
      // Nothing is anchored on a line, so new commits don't keep the reviewer from approving.
      allowStale: true,
      hunkComments: [],
      verdict: "approve",
    });
    if (!result.ok) return;
    approveId.current = null;
    did("approved");
    threads.reload();
    void refetch();
  };
  const revoke = useMutation(client.revokeApproval);
  const revokeNow = async () => {
    const result = await revoke.run(analysisId);
    if (result.ok) did(null);
  };

  // What publishing will post on the code: the reviewer's comments, raised points among them.
  const toPost = hunkComments.length;
  const bar = barButtons({
    aiDone: MODEL_STAGES.every((stage) => live.stages[stage] === "done"),
    running: modelRunning,
    pending: toPost,
    isAuthor: view.isAuthor,
    stale: view.stale,
    verdict: yourVerdict,
  });
  const totals = useMemo(() => changeTotals(analysis.files), [analysis.files]);
  const failureTitle =
    pointStates.failure === null
      ? ""
      : (points.find((point) => point.id === pointStates.failure?.pointId)?.title ?? "");

  /**
   * "Don't flag things like this": the rule is saved as a preference the reviewer learned from the
   * point, which is then dismissed. A rule that isn't saved leaves the point as it was.
   */
  const saveRule = async (point: Point, rule: RuleFields): Promise<string | null> => {
    const saved = await client.addPreference({ ...rule, source: "learned" });
    if (!saved.ok) return failureReason(saved.error);
    void pointStates.setState(point.id, "dismissed");
    return null;
  };
  const actionsOf = (point: Point): PointActions => ({
    state: pointStates.stateOf(point.id),
    saving: pointStates.isSaving(point.id),
    readOnly,
    current: activePoint === point.id,
    onRaise: stable.raisePoint,
    onState: stable.setPointState,
    leftOut: folded.has(point.id),
    onShow: showLeftOut,
    ruleScopes,
    onRule: stable.saveRule,
  });
  /** A point's card, with the lines its suggestion replaces and whether its draft is written. */
  const findingCard = (point: Point, partId: PartId | null) => {
    const found = partId === null ? undefined : index.parts.get(partId);
    const lines = point.lines;
    const inReview =
      partId !== null &&
      lines !== null &&
      commentsOf(partId).some(
        (comment) => comment.side === lines.side && comment.line === lines.line,
      );
    return (
      <FindingCard
        key={point.id}
        point={point}
        {...actionsOf(point)}
        family={family}
        linesAbove={cardPlaces.rowsAbove.get(point.id) ?? 0}
        inReview={inReview}
        removed={
          found === undefined || lines === null || lines.side === "old"
            ? null
            : coveredLines(found.hunk, lines.startLine, lines.line)
        }
        language={found === undefined ? null : languageOf(found.file)}
      />
    );
  };
  // The lines each part's points rest on, so they take the mark; where points overlap, the first's.
  // A point landing in view gives its lines their place in the timeline.
  const pointLines = useMemo(() => {
    const byPart = new Map<PartId, Map<string, PointLine>>();
    for (const [partId, placed] of places.cards) {
      const lines = new Map<string, PointLine>();
      for (const point of placed) {
        // A point folded as left out marks no line.
        if (point.lines === null || folded.has(point.id)) continue;
        const { side, startLine, line: last } = point.lines;
        const at = landingAt(point.id);
        for (let line = startLine; line <= last; line += 1) {
          const key = `${side}:${line}`;
          if (lines.has(key)) continue;
          lines.set(key, {
            kind: pointTone(point),
            ...(at === undefined
              ? {}
              : { landing: { at, line: line - startLine, lines: last - startLine + 1 } }),
          });
        }
      }
      if (lines.size > 0) byPart.set(partId, lines);
    }
    return byPart;
  }, [places, landingAt, folded]);
  const hunkFiles = useMemo(
    () =>
      new Map(
        analysis.files.flatMap((file) =>
          file.hunks.map((hunk) => [hunk.id, { hunk, file }] as const),
        ),
      ),
    [analysis.files],
  );
  // The lines of the step the map was opened from, marked on their numbers where no point is.
  const stepLines = useMemo(() => {
    if (fromStep === null) return null;
    const hunk = hunkFiles.get(fromStep.excerpt.hunkId)?.hunk;
    if (hunk === undefined) return null;
    const keys = hunk.lines.slice(fromStep.excerpt.start, fromStep.excerpt.end).flatMap((line) => {
      const place = commentPlace(line);
      return place === null ? [] : [`${place.side}:${place.line}`];
    });
    return { hunkId: fromStep.excerpt.hunkId, keys };
  }, [fromStep, hunkFiles]);
  const pointLinesOf = useCallback(
    (id: PartId) => {
      const own = pointLines.get(id);
      if (stepLines === null || hunkIdOf(id) !== stepLines.hunkId) return own;
      const merged = new Map<string, PointLine>(own ?? []);
      for (const key of stepLines.keys) if (!merged.has(key)) merged.set(key, { kind: "step" });
      return merged;
    },
    [pointLines, stepLines],
  );
  /** A fold of point cards: fresh while it's landing if any of them is new to the page. */
  const fold = (
    together: readonly Point[],
    props: Pick<Parameters<typeof PointFold>[0], "row" | "className" | "bodyClassName">,
    children: ReactNode,
  ): ReactNode => {
    const [lead] = together;
    if (lead === undefined) return null;
    return (
      <PointFold
        key={lead.id}
        pointId={lead.id}
        fresh={together.some((point) => landing.fresh(point.id))}
        at={landingAt(lead.id)}
        {...props}
      >
        {children}
      </PointFold>
    );
  };
  // Points whose lines the part doesn't show, and links to cards on other parts.
  const pointsOn = (id: PartId): ReactNode => {
    const cards = cardPlaces.underHeader.get(id) ?? NO_POINTS;
    const mentions = places.mentions.get(id) ?? NO_POINTS;
    const label =
      fromStep !== null && fromStep.excerpt.partId === id ? (
        <TourLanding step={fromStep.step} excerpt={fromStep.excerpt} />
      ) : null;
    return label === null ? (
      pointFolds(cards, mentions, id)
    ) : (
      <>
        {label}
        {pointFolds(cards, mentions, id)}
      </>
    );
  };
  const pointFolds = (
    cards: readonly Point[],
    mentions: readonly Point[],
    id: PartId,
  ): ReactNode => {
    return fold(
      [...cards, ...mentions],
      { bodyClassName: "flex flex-col gap-2 border-b bg-surface-subtle p-3" },
      <>
        {cards.map((point) => findingCard(point, id))}
        {mentions.map((point) => (
          <PointMention key={point.id} point={point} onGo={stable.goToPoint} />
        ))}
      </>,
    );
  };
  // Points under the last of their lines, which they grow out from when they land.
  const pointsAt = (id: PartId, place: LinePlace): ReactNode => {
    const key = placeKey(place);
    const here = cardPlaces.underLine.get(id)?.get(key) ?? NO_POINTS;
    return fold(
      here,
      {
        row: true,
        className: PINNED,
        bodyClassName: "flex max-w-3xl flex-col gap-2 py-2 pr-3 pl-29 font-sans",
      },
      here.map((point) => findingCard(point, id)),
    );
  };
  const flagsOf = useCallback(
    (id: PartId): ReadonlyMap<string, PointTone> | undefined => {
      const lines = cardPlaces.underLine.get(id);
      if (lines === undefined) return undefined;
      return new Map(
        [...lines].flatMap(([key, here]) => {
          const first = here.find((point) => !folded.has(point.id));
          return first === undefined ? [] : [[key, pointTone(first)] as const];
        }),
      );
    },
    [cardPlaces, folded],
  );
  // Map cards render again only when their signature changes, so their handlers call the latest.
  const latest = useRef({ goToPoint, raisePoint, saveRule });
  latest.current = { goToPoint, raisePoint, saveRule };
  const stable = useMemo(
    () => ({
      goToPoint: (id: PointId) => latest.current.goToPoint(id),
      raisePoint: (point: Point, add: boolean) => latest.current.raisePoint(point, add),
      saveRule: (point: Point, rule: RuleFields) => latest.current.saveRule(point, rule),
      setPointState: pointStates.setState,
    }),
    [pointStates.setState],
  );
  // A rule saved from a point is for its repository unless the reviewer chooses everywhere.
  const repo = analysis.key.ref.repo;
  const ruleScopes = useMemo(() => scopeOptions([repo]).reverse(), [repo]);
  /**
   * The raised point a draft was made from, with a guardrail: its card is on the draft's part, and
   * the draft is on the line its Add to review or Comment put it.
   */
  const guardedPointOf = (id: PartId, comment: LineComment): Point | undefined => {
    const found = index.parts.get(id);
    if (found === undefined) return undefined;
    const firstChanged = found.hunk.lines.find((one) => one.kind !== "context");
    const fallback = firstChanged === undefined ? null : commentPlace(firstChanged);
    return points.find((point) => {
      if (point.guardrail === undefined || places.cardPart.get(point.id) !== id) return false;
      if (pointStates.stateOf(point.id) !== "raised") return false;
      const place = point.lines === null ? fallback : point.lines;
      return place !== null && place.side === comment.side && place.line === comment.line;
    });
  };
  const signatureOf = (id: PartId): string => {
    const parts: unknown[] = [
      epochOf(analysis),
      readOnly,
      highlight.has(id),
      openComment?.partId === id ? JSON.stringify(openComment.place) : "",
      ...commentsOf(id).map((comment) => JSON.stringify(comment)),
    ];
    // A part with threads draws again when they change, or another becomes the current one.
    if (placement.onLine.has(id)) parts.push(epochOf(placement), activeThread ?? "");
    const cards = places.cards.get(id) ?? NO_POINTS;
    const mentions = places.mentions.get(id) ?? NO_POINTS;
    for (const point of cards) {
      parts.push(point.id, pointStates.stateOf(point.id), pointStates.isSaving(point.id));
      parts.push(activePoint === point.id, folded.has(point.id));
    }
    for (const point of mentions) parts.push(point.id);
    for (const point of [...cards, ...mentions]) {
      parts.push(landing.fresh(point.id), landingAt(point.id) ?? "");
    }
    if (stepLines !== null && hunkIdOf(id) === stepLines.hunkId) parts.push(fromStep?.excerpt.key);
    return parts.join("\u0000");
  };
  /** A step's excerpt: its rows, drawn as a part's, with the comment box and the drafts on them. */
  const excerptCard = (excerpt: TourExcerpt): ReactNode => {
    const found = hunkFiles.get(excerpt.hunkId);
    if (found === undefined) return null;
    const shown = partHunk(found.hunk, excerpt);
    const onShownLine = (comment: HunkComment) =>
      comment.hunkId === excerpt.hunkId &&
      shown.lines.some((line) => {
        const place = commentPlace(line);
        return place !== null && place.side === comment.side && place.line === comment.line;
      });
    const open = openComment?.partId === excerpt.partId ? openComment.place : null;
    return (
      <HunkCard
        id={excerpt.partId}
        hunk={shown}
        file={found.file}
        risk={index.items([excerpt.partId])[0]?.risk ?? null}
        inFile
        comments={hunkComments.filter(onShownLine)}
        openComment={
          open !== null && shown.lines.some((line) => commentPlace(line)?.line === open.line)
            ? open
            : null
        }
        onOpenComment={openCommentOn}
        onCancelComment={cancelComment}
        {...(complete ? { onComment: writeComment, onCommentNow: postCommentNow } : {})}
        threadsAt={(place) => threadsAt(excerpt.partId, place)}
        {...(RANGE_NOTES[analysis.key.ref.repo.host] === undefined
          ? {}
          : { rangeNote: RANGE_NOTES[analysis.key.ref.repo.host] })}
      />
    );
  };
  const deps: HunkDeps = {
    index,
    unchangedOf,
    highlighted: highlight,
    commentsOf,
    openComment,
    onOpenComment: openCommentOn,
    onCancelComment: cancelComment,
    // Line comments stay open once a review is published: they go with the next, or post now.
    onComment: complete ? writeComment : undefined,
    ...(complete ? { onCommentNow: postCommentNow } : {}),
    // Under a saved draft a point with a guardrail made: the check, with Add to comment.
    draftNote: (id, comment, edit) => {
      const point = guardedPointOf(id, comment);
      return point?.guardrail === undefined ? null : (
        <DraftGuardrail
          guardrail={point.guardrail}
          family={family}
          body={comment.body}
          onEdit={edit}
        />
      );
    },
    onFocusHunk: focusHunk,
    marksOf,
    pointsOn,
    pointsAt,
    flagsOf,
    pointLinesOf,
    threadsAt,
    earlierThreads,
    openThreads,
    ...(RANGE_NOTES[analysis.key.ref.repo.host] === undefined
      ? {}
      : { rangeNote: RANGE_NOTES[analysis.key.ref.repo.host] }),
  };
  const before = (
    <>
      {places.unplaced.length > 0 && (
        <section aria-label="Points on no change shown here">
          {fold(
            places.unplaced,
            { bodyClassName: "flex flex-col gap-2" },
            places.unplaced.map((point) => findingCard(point, null)),
          )}
        </section>
      )}
    </>
  );

  return (
    <div
      data-slot="review-page"
      data-layout={layout}
      // The landing of Claude's results, which globals.css plays (useLanding).
      data-landing={landing.phase}
      className="mx-auto flex max-w-[1600px] flex-col gap-4"
    >
      <ReviewHeader
        view={view}
        repository={
          <RepositoryStatus
            analysis={analysis}
            searched={status?.cloneSearchFolder}
            copies={status?.downloadFolder}
          />
        }
        intent={
          <IntentLine
            analysis={live}
            running={landing.running}
            stale={view.stale}
            tour={
              tourReady && tour !== null
                ? { steps: tour.steps.length, onOpen: () => enterTour(0) }
                : null
            }
            onDetails={() => {
              detailsReturnFocus.current = true;
              setShowDetails(true);
            }}
          />
        }
        totals={totals}
        status={prStatus.status}
        statusError={prStatus.error}
        onRetryStatus={prStatus.reload}
        now={Date.now()}
      />
      <ReviewBar
        layout={
          analysis.stages.prep === "done" ? (
            <LayoutSwitch layout={layout} tour={tourReady} onChange={chooseLayout} />
          ) : null
        }
        title={live.pullRequest?.title ?? null}
        claude={
          <ClaudeElement
            analysis={live}
            choice={modelChoice}
            running={landing.running}
            starting={runModel.pending}
            error={
              runModel.error !== null
                ? errorMessage(runModel.error)
                : reanalyze.error !== null
                  ? errorMessage(reanalyze.error)
                  : null
            }
            harness={harness}
            filesChanged={analysis.stages.prep === "done" ? totals.files : null}
            reanalyze={
              view.stale
                ? {
                    starting: reanalyze.pending,
                    onReanalyze: async () => {
                      const result = await reanalyze.run({ url: prUrl });
                      if (result.ok) open(result.value.analysisId);
                    },
                  }
                : null
            }
            onRerun={() => setRerunning(true)}
            points={walked}
            leftOut={folded.size}
            threads={threadChip(orderedThreads, threadScope, resolvedHere)}
            narrowed={narrowed === "thread" ? narrowed : walkedType}
            onNarrow={narrow}
            onRun={async () => {
              const optionId = modelChoice.chosen?.id;
              const result = await runModel.run(analysisId, {
                ...(optionId === undefined ? {} : { optionId }),
                ...(tourOn ? { tour: true } : {}),
              });
              if (!result.ok) return;
              follow();
            }}
          >
            {!walkingThreads ? (
              <PointStepper
                points={walked}
                type={walkedType}
                current={currentPoint}
                stateOf={pointStates.stateOf}
                onGo={goToPoint}
                onOpenList={() => setShowPoints(true)}
              />
            ) : (
              orderedThreads.length > 0 && (
                <ThreadStepper
                  ordered={orderedThreads}
                  scope={threadScope}
                  resolvedHere={resolvedHere}
                  current={currentThread}
                  onGo={goToThread}
                  onOpenList={() => setShowThreads(true)}
                />
              )
            )}
          </ClaudeElement>
        }
        tools={
          layout === "map" && (
            <Button
              variant="outline"
              size="sm"
              className="lg:hidden"
              aria-expanded={railOpen}
              aria-controls="review-tree-rail"
              onClick={() => setRailOpen(!railOpen)}
            >
              {railOpen ? "Hide files" : "Show files"}
            </Button>
          )
        }
        publish={
          canPublish && (
            <>
              {bar.order.map((which) =>
                which === "approve" && bar.approve.revoke ? (
                  <Button
                    key="approve"
                    variant="outline"
                    data-slot="revoke-approval-button"
                    disabled={revoke.pending}
                    onClick={() => void revokeNow()}
                  >
                    <Undo2Icon aria-hidden="true" />
                    <span className="max-sm:sr-only">
                      {revoke.pending ? "Revoking…" : "Revoke approval"}
                    </span>
                  </Button>
                ) : which === "approve" ? (
                  <Tooltip key="approve" disabled={bar.approve.disabledReason === null}>
                    <TooltipTrigger
                      render={
                        <Button
                          variant={bar.approve.filled ? "approve" : "outline"}
                          data-slot="approve-button"
                          disabled={approve.pending || bar.approve.disabledReason !== null}
                          focusableWhenDisabled
                          aria-describedby={
                            bar.approve.disabledReason === null ? undefined : "approve-reason"
                          }
                          onClick={() => void approveNow()}
                        />
                      }
                    >
                      <CircleCheckIcon
                        aria-hidden="true"
                        className={cn(!bar.approve.filled && "text-review-approved")}
                      />
                      {/* Below 640px the icon alone; a screen reader still hears the word. */}
                      <span className="max-sm:sr-only">
                        {approve.pending ? "Approving…" : "Approve"}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" align="end">
                      {bar.approve.disabledReason}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <Button
                    key="publish"
                    variant={bar.publish.filled ? "default" : "outline"}
                    data-slot="publish-button"
                    aria-haspopup="dialog"
                    onClick={() => void openPublish()}
                  >
                    {/* Below 640px "Publish…"; a screen reader hears it all. */}
                    <span className="max-sm:sr-only">Publish review…</span>
                    <span aria-hidden="true" className="sm:hidden">
                      Publish…
                    </span>
                    {bar.publish.count > 0 && (
                      <span className="tabular rounded-full bg-primary-foreground px-1.5 text-caption text-primary">
                        {bar.publish.count}
                        <span className="sr-only"> to post</span>
                      </span>
                    )}
                  </Button>
                ),
              )}
              {bar.approve.disabledReason !== null && (
                <span id="approve-reason" hidden>
                  {bar.approve.disabledReason}
                </span>
              )}
            </>
          )
        }
        verdict={verdictLabel(yourVerdict, verdictKnown, publication)}
        hairline={landing.running ? "running" : landing.phase === "landing" ? "finishing" : null}
      />

      {!complete && (
        <ProgressStrip stages={live.stages} shown={CODE_STAGES} filesFetched={live.filesFetched} />
      )}
      {live.error !== null && (
        <div className={cn(DANGER, "flex flex-col items-start gap-2")} role="alert">
          <p>
            The analysis failed at the {stageName(live.error.stage).toLowerCase()} stage:{" "}
            {live.error.message}
          </p>
          {retry.error !== null && <p>Couldn't retry. {errorMessage(retry.error)}</p>}
          <Button
            variant="outline"
            size="sm"
            disabled={retry.pending}
            onClick={async () => {
              const result = await retry.run(analysisId);
              if (result.ok) open(result.value.analysisId);
            }}
          >
            {retry.pending ? "Retrying…" : "Retry"}
          </Button>
        </div>
      )}
      {approve.error !== null && (
        <div
          className={cn(DANGER, "flex flex-wrap items-center justify-between gap-2")}
          role="alert"
        >
          <p>Couldn't approve. {errorMessage(approve.error)}</p>
          <Button variant="ghost" size="sm" onClick={approve.reset}>
            Dismiss
          </Button>
        </div>
      )}
      {revoke.error !== null && (
        <div
          className={cn(DANGER, "flex flex-wrap items-center justify-between gap-2")}
          role="alert"
        >
          <p>Couldn't revoke the approval. {errorMessage(revoke.error)}</p>
          <Button variant="ghost" size="sm" onClick={revoke.reset}>
            Dismiss
          </Button>
        </div>
      )}
      {pointStates.failure !== null && (
        <div
          className={cn(DANGER, "flex flex-wrap items-center justify-between gap-2")}
          role="alert"
        >
          <p>
            Couldn't save what you did with “{failureTitle}”. {pointStates.failure.message}
          </p>
          <Button variant="ghost" size="sm" onClick={pointStates.dismissFailure}>
            Dismiss
          </Button>
        </div>
      )}

      {threads.error !== null && (
        <div role="status" className={cn(WARNING, "flex flex-wrap items-center gap-3")}>
          <span>
            <span aria-hidden="true">⚠ </span>
            Couldn't read the comments on the pull request. {errorMessage(threads.error)}
          </span>
          <Button variant="outline" size="sm" onClick={threads.reload}>
            Try again
          </Button>
        </div>
      )}
      {analysis.stages.prep !== "done" ? (
        <section aria-busy={analysis.status === "running"}>
          <p className="text-muted-foreground">
            {analysis.status === "running"
              ? "Reading the diff…"
              : "The diff couldn't be read, so there are no changes to show."}
          </p>
        </section>
      ) : layout === "map" ? (
        <div
          className={cn(
            MAP_GRID,
            "[&>aside]:hidden lg:[&>aside]:flex",
            railOpen && "[&>aside]:flex",
          )}
        >
          <Rail>
            <FileTree
              files={treeWithThreads}
              activePath={fileInView}
              onSelect={(path) => scrollTo(fileAnchor(path))}
              className="min-h-0 flex-1"
            />
          </Rail>
          <MapLayout
            analysis={analysis}
            files={files}
            deps={deps}
            before={before}
            after={
              placement.elsewhere.length > 0 && (
                <section
                  aria-label="Comments on other files"
                  className="flex flex-col gap-2 rounded-lg border bg-surface-subtle p-3"
                >
                  <h2 className="text-caption font-medium text-muted-foreground">
                    Comments on files without a card here
                  </h2>
                  {placement.elsewhere.map((thread) => (
                    <div key={thread.id} className="flex flex-col gap-1">
                      <span className="font-mono text-code-compact">{thread.path}</span>
                      {threadView(thread, null)}
                    </div>
                  ))}
                </section>
              )
            }
            trailingProofs={trailing}
            mechanicalCount={mechanical}
            scrollRequest={scrollRequest}
            signatureOf={signatureOf}
          />
        </div>
      ) : understand && tour !== null ? (
        <Understand
          tour={tour}
          stateOf={(point) => stateOf(point.id)}
          renderExcerpt={excerptCard}
          onOpenPoint={(point) => goToPoint(point.id)}
          onOpenFile={openFileFromTour}
          onOpenInCode={openInCode}
          onCurrentStep={(step) => {
            if (step !== null) writeSession(storedStepKey, step);
          }}
          landOn={landOn}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {flow === null ? (
            <Overview
              overview={overview}
              focusKey={overviewFocus}
              currentPath={fileInView}
              onOpen={openNode}
              onExpand={(key) => setExpandedGroups((previous) => [...previous, key])}
              expandedGroups={expandedGroups}
              onCollapse={(key) =>
                setExpandedGroups((previous) => previous.filter((other) => other !== key))
              }
              onFocusNode={(key) => {
                overviewAt.current = key;
              }}
              onOpenFile={openFileFromTour}
            />
          ) : overviewForm === "lanes" ? (
            <FlowLanes
              flow={flow}
              opened={flowOpened}
              onToggle={toggleFlow}
              focusKey={overviewFocus}
              onOpenPart={openFlowPart}
              onOpenFile={openFileFromTour}
            />
          ) : overviewForm === "bow-tie" ? (
            <FlowBowTie
              flow={flow}
              opened={flowOpened}
              onToggle={toggleFlow}
              focusKey={overviewFocus}
              onOpenPart={openFlowPart}
              onOpenFile={openFileFromTour}
            />
          ) : (
            <FlowRows
              flow={flow}
              focusKey={overviewFocus}
              onOpenPart={openFlowPart}
              onOpenFile={openFileFromTour}
            />
          )}
        </div>
      )}

      {complete && <SelectionComment onComment={openCommentOn} />}

      <footer className="flex items-center justify-end gap-3">
        <ModelCalls
          calls={live.modelCalls}
          option={live.modelOption}
          guidance={live.guidance}
          leftOut={points.filter((point) => point.guidance?.effect === "left-out").length}
          preferences={scopePath({ kind: "repo", repo: analysis.key.ref.repo })}
        />
        {complete && !modelRunning && hasModelRun(live) && (
          // A new run of the code's stages under the same ID: the page starts afresh to follow it.
          <RemoveModelRun
            analysisId={analysisId}
            family={family}
            // The page starts afresh, so nothing of the run is left in it, from what came back.
            onRemoved={(removed) => restart({ ...view, ...removed })}
          />
        )}
        <UsageFooter
          usage={live.usage}
          option={live.modelOption}
          guidance={live.guidance}
          calls={live.modelCalls}
        />
      </footer>

      {rerunning && modelChoice.chosen !== null && (
        <RerunModel
          analysisId={analysisId}
          view={view}
          family={family}
          chosen={modelChoice.chosen}
          tour={tourOn}
          onClose={() => setRerunning(false)}
          onRestart={(seed) => restart(seed)}
        />
      )}
      {publishing && (
        <PublishDialog
          analysisId={analysisId}
          hunkComments={hunkComments}
          isAuthor={view.isAuthor}
          published={publication !== null}
          onClose={() => setPublishing(false)}
          onPublished={(_, verdict) => {
            setPublishing(false);
            // The drafts are threads on the host now; read those instead of keeping both.
            setHunkComments(() => []);
            threads.reload();
            did(verdictAfter(verdict, yourVerdict));
            void refetch();
          }}
        />
      )}
      {showThreads && (
        <ThreadList
          ordered={orderedThreads}
          scope={threadScope}
          onScope={setThreadScope}
          onGo={(id) => {
            setShowThreads(false);
            goToThread(id);
          }}
          onClose={() => setShowThreads(false)}
        />
      )}
      {showPoints && (
        <PointList
          points={walked}
          family={family}
          stateOf={pointStates.stateOf}
          onGo={(id) => {
            setShowPoints(false);
            goToPoint(id);
          }}
          onClose={() => setShowPoints(false)}
        />
      )}
      <ShortcutsDialog open={showShortcuts} onOpenChange={setShowShortcuts} ids={PAGE_SHORTCUTS} />
      <CallPeek handle={callPeek} onGoTo={(id) => scrollTo(hunkAnchor(id))} />
      {showDetails && (
        <Dialog
          title={analysis.intent === null ? "What was asked" : "Intent"}
          onClose={() => setShowDetails(false)}
          className="sm:max-w-4xl"
          returnFocus={() => detailsReturnFocus.current}
        >
          {analysis.intent !== null ? (
            <IntentPanel
              intent={analysis.intent}
              tickets={analysis.tickets}
              missingTicketKeys={analysis.missingTicketKeys}
              onSelectMismatch={(at) => {
                // The code takes the focus, so closing doesn't hand it back to Details.
                detailsReturnFocus.current = false;
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
      <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
        Press <KeyHint id="help" /> for keyboard shortcuts.
      </p>
    </div>
  );
};
