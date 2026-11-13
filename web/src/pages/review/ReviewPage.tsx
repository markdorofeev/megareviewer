import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import type { AnalysisView } from "../../../../contracts/index.ts";
import {
  type Hunk,
  hunkIdOf,
  type PartId,
  type UnchangedCallers,
} from "../../../../src/domain/diff/index.ts";
import {
  type Analysis,
  type AnalysisId,
  HunkComment,
  inProgress,
  type Point,
  PointId,
  type PointKind,
  pointsOf,
  pullRequestUrl,
  type ReviewThread,
} from "../../../../src/domain/review/index.ts";
import { errorMessage, useAnalysisView, useApi, useMutation, useStatus } from "../../api/index.ts";
import { Link } from "../../app/Link.tsx";
import { navigate, reviewPath } from "../../app/router.ts";
import { type ShortcutHandlers, type ShortcutId, useShortcuts } from "../../lib/keymap.ts";
import { usePageDisplay } from "../../lib/page-display.tsx";
import { cn } from "../../lib/utils.ts";
import {
  CallPeek,
  commentPlace,
  createCallPeekHandle,
  DANGER,
  DiffSkeleton,
  FileTree,
  KeyHint,
  type LineComment,
  type LinePlace,
  LineRow,
  languageOf,
  PINNED,
  type PointLine,
  ReviewThreadView,
  ShortcutsDialog,
  TreeSkeleton,
  threadPlace,
  WARNING,
} from "../../review/index.ts";
import { Button } from "../../ui/button.tsx";
import { Skeleton } from "../../ui/skeleton.tsx";
import { ClaudeElement } from "./ClaudeElement.tsx";
import { callMarks } from "./calls.tsx";
import { Dialog } from "./Dialog.tsx";
import { type HunkDeps, hunkAnchor } from "./HunkView.tsx";
import { IntentLine } from "./IntentLine.tsx";
import { IntentPanel } from "./IntentPanel.tsx";
import { fileAnchor, MapLayout, MECHANICAL_ANCHOR, type ScrollRequest } from "./MapLayout.tsx";
import {
  changeTotals,
  commentsInParts,
  contractParts,
  type Layout,
  mapFiles,
  mechanicalCount,
  parseLayout,
  partIndex,
  pointPlaces,
  threadTotals,
  tourSteps,
  trailingProofs,
} from "./model.ts";
import { Overview } from "./Overview.tsx";
import { fileOverview, type OverviewNode } from "./overview.ts";
import {
  DecisionChip,
  DecisionNote,
  FindingCard,
  type PointActions,
  PointFold,
  PointMention,
  pointAnchor,
  RiskBand,
} from "./PointCard.tsx";
import { PointList } from "./PointList.tsx";
import { PointStepper } from "./PointStepper.tsx";
import { CODE_STAGES, ProgressStrip, stageName } from "./ProgressStrip.tsx";
import { PublishDialog } from "./PublishDialog.tsx";
import { Rail } from "./Rail.tsx";
import { ReviewBar } from "./ReviewBar.tsx";
import { ReviewHeader } from "./ReviewHeader.tsx";
import { StatedIntent } from "./StatedIntent.tsx";
import { narrowTo } from "./stepper.ts";
import { useStoredState } from "./storage.ts";
import { coveredLines, placeKey, placeThreads } from "./threads.ts";
import { UsageFooter } from "./UsageFooter.tsx";
import { useFileInView } from "./useFileInView.ts";
import { useLanding } from "./useLanding.ts";
import { usePoints } from "./usePoints.ts";
import { useThreads } from "./useThreads.ts";

const NO_COMMENTS: readonly HunkComment[] = [];
const parseHunkComments = (stored: unknown): readonly HunkComment[] | undefined =>
  HunkComment.array().safeParse(stored).data;

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
  const { view, error, refetch, follow } = useAnalysisView(analysisId);
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

const LAYOUTS: readonly { readonly value: Layout; readonly label: string }[] = [
  { value: "map", label: "Map" },
  { value: "overview", label: "Overview" },
];

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
/** Why callers outside the pull request aren't shown, when no checkout was read. */
const CheckoutNote = ({ analysis }: { readonly analysis: AnalysisView["analysis"] }) => {
  const { checkout, pullRequest } = analysis;
  if (checkout === "read" || pullRequest === null) return null;
  const { ref, headSha } = pullRequest;
  return (
    <p data-slot="checkout-note" className="text-muted-foreground">
      Code outside the pull request that calls what it changes isn't shown:{" "}
      {checkout === "missing-commit" ? (
        <>
          the local checkout doesn't have the head commit{" "}
          <code className="rounded-sm bg-muted px-1 font-mono text-code-compact">
            {headSha.slice(0, 7)}
          </code>
          . Run{" "}
          <code className="rounded-sm bg-muted px-1 font-mono text-code-compact">git fetch</code> in
          it
          {ref.repo.host === "github" && (
            <>
              , or{" "}
              <code className="rounded-sm bg-muted px-1 font-mono text-code-compact">
                git fetch origin pull/{ref.number}/head
              </code>{" "}
              for a pull request from a fork
            </>
          )}
          , then open the pull request again.
        </>
      ) : (
        <>
          megareviewer didn't run in a checkout of {ref.repo.owner}/{ref.repo.repo}. Start it in
          one, or pass{" "}
          <code className="rounded-sm bg-muted px-1 font-mono text-code-compact">
            --checkout &lt;dir&gt;
          </code>
          , then open the pull request again.
        </>
      )}
    </p>
  );
};

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

/** The "side:line" of the first of a point's lines a part shows, which a risk's band goes over. */
const firstLineShown = (point: Point, hunk: Hunk): string | null => {
  const { lines } = point;
  if (lines === null) return null;
  for (const one of hunk.lines) {
    const place = commentPlace(one);
    if (place === null || place.side !== lines.side) continue;
    if (place.line >= lines.startLine && place.line <= lines.line) return placeKey(place);
  }
  return null;
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
  readonly restart: () => void;
}) => {
  const { client } = useApi();
  const modelStatus = useStatus().status?.model ?? null;
  const { analysis: live, publication } = view;
  const analysisId = live.id;
  const complete = live.status === "complete";
  // Claude's passes, running on the complete analysis since the reviewer asked for them.
  const modelRunning = complete && inProgress(live);
  // The code, the tree and the receipt stay as they were until Claude's run ends; only the
  // header follows it.
  const analysis = useSettled(live, modelRunning);
  const runModel = useMutation(client.runModel);
  const readOnly = publication !== null || !complete;

  const index = useMemo(() => partIndex(analysis), [analysis]);
  const steps = useMemo(() => tourSteps(analysis, index), [analysis, index]);
  const files = useMemo(() => mapFiles(analysis, index), [analysis, index]);
  const order = useMemo(() => files.flatMap((group) => group.partIds), [files]);
  const trailing = useMemo(() => trailingProofs(analysis, index), [analysis, index]);
  const mechanical = mechanicalCount(trailing);
  const points = useMemo(() => pointsOf(analysis), [analysis]);
  const pointIds = useMemo(() => points.map((point) => point.id), [points]);
  const landing = useLanding(modelRunning, pointIds);
  const places = useMemo(() => pointPlaces(points, order, index), [points, order, index]);
  // Where each point goes on its part, by its kind: a finding's card under the last of its lines
  // the part shows, a risk's band over the first, a decision's chip at the end of the last. A
  // point whose lines the part doesn't show goes under its header.
  const cardPlaces = useMemo(() => {
    const underLine = new Map<PartId, Map<string, Point[]>>();
    const overLine = new Map<PartId, Map<string, Point[]>>();
    const atLineEnd = new Map<PartId, Map<string, Point[]>>();
    const underHeader = new Map<PartId, Point[]>();
    const rowsAbove = new Map<PointId, number>();
    const add = (
      map: Map<PartId, Map<string, Point[]>>,
      partId: PartId,
      key: string,
      point: Point,
    ) => {
      const lines = map.get(partId) ?? new Map<string, Point[]>();
      lines.set(key, [...(lines.get(key) ?? []), point]);
      map.set(partId, lines);
    };
    for (const [partId, placed] of places.cards) {
      const part = index.parts.get(partId);
      for (const point of placed) {
        const last = part === undefined ? null : lastLineShown(point, part.hunk);
        const first = part === undefined ? null : firstLineShown(point, part.hunk);
        if (last === null || first === null) {
          underHeader.set(partId, [...(underHeader.get(partId) ?? []), point]);
        } else if (point.kind === "risk") {
          add(overLine, partId, first, point);
        } else if (point.kind === "decision") {
          add(atLineEnd, partId, last.key, point);
        } else {
          add(underLine, partId, last.key, point);
          rowsAbove.set(point.id, last.rows);
        }
      }
    }
    return { underLine, overLine, atLineEnd, underHeader, rowsAbove };
  }, [places, index]);
  // Points that share a fold land with its first: the fold is what's measured and unfolds.
  const foldOf = useMemo(() => {
    const first = new Map<PointId, PointId>();
    const share = (together: readonly Point[]) => {
      const [lead] = together;
      for (const point of together) if (lead !== undefined) first.set(point.id, lead.id);
    };
    for (const placed of [cardPlaces.underLine, cardPlaces.overLine])
      for (const lines of placed.values()) for (const here of lines.values()) share(here);
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
  // Each file's points by kind, for the tree's marks.
  const pointsByFile = useMemo(() => {
    const byPath = new Map<string, Partial<Record<Point["kind"], number>>>();
    for (const [partId, placed] of places.cards) {
      const path = index.parts.get(partId)?.file.path;
      if (path === undefined) continue;
      const counts = byPath.get(path) ?? {};
      for (const point of placed) counts[point.kind] = (counts[point.kind] ?? 0) + 1;
      byPath.set(path, counts);
    }
    return byPath;
  }, [places, index]);
  const contractOf = useMemo(() => {
    const counts = new Map(files.map((group) => [group.file.path, contractParts(group, index)]));
    return (path: string) => counts.get(path) ?? 0;
  }, [files, index]);
  const treeFiles = useMemo(
    () =>
      files.map(({ file }) => ({
        path: file.path,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        contract: contractOf(file.path),
        ...(pointsByFile.has(file.path) ? { points: pointsByFile.get(file.path) } : {}),
      })),
    [files, contractOf, pointsByFile],
  );
  // Directories the reviewer opened in the overview, to see their files.
  const [expandedGroups, setExpandedGroups] = useState<readonly string[]>([]);
  const overview = useMemo(
    () => fileOverview(analysis, steps, new Set(expandedGroups), contractOf),
    [analysis, steps, expandedGroups, contractOf],
  );

  const [layout, setLayout] = useStoredState("review-layout", "map", parseLayout);
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
  // The overview node the map was opened from, for Esc to go back to.
  const [openedFrom, setOpenedFrom] = useState<string | null>(null);
  const [currentPoint, setCurrentPoint] = useState<PointId | null>(null);
  // The kind a chip narrowed the stepper to.
  const [narrowed, setNarrowed] = useState<PointKind | null>(null);
  const [showPoints, setShowPoints] = useState(false);
  // Decisions are footnotes: the reviewer can hide them all, and opens one at a time.
  const [decisionsShown, setDecisionsShown] = useStoredState("decisions-shown", true, (stored) =>
    typeof stored === "boolean" ? stored : undefined,
  );
  const [openDecisions, setOpenDecisions] = useState<ReadonlySet<PointId>>(new Set());
  const toggleDecision = useCallback(
    (id: PointId) =>
      setOpenDecisions((previous) => {
        const next = new Set(previous);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [],
  );
  // When this page saw Claude's run start, for the time since.
  const [modelStartedAt, setModelStartedAt] = useState<number | null>(null);
  // The hunks of a decision or mismatch the reviewer went to.
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
        // A draft with nothing in it is removed; a severity or a suggestion is something.
        const empty =
          comment.body === "" && comment.severity === undefined && comment.suggestion === undefined;
        if (!previous.some(same)) return empty ? previous : [...previous, written];
        return empty
          ? previous.filter((other) => !same(other))
          : previous.map((other) => (same(other) ? written : other));
      }),
    [setHunkComments],
  );
  const openCommentOn = useCallback(
    (partId: PartId, place: LinePlace | null) => {
      setOpenComment((previous) => {
        // Extending a comment into a range takes its draft along to the range's last line.
        if (place?.startLine !== undefined && previous !== null && previous.partId === partId) {
          const hunkId = hunkIdOf(partId);
          const from = previous.place;
          setHunkComments((comments) =>
            comments.map((comment) =>
              comment.hunkId === hunkId && comment.side === from.side && comment.line === from.line
                ? { ...comment, line: place.line, startLine: place.startLine }
                : comment,
            ),
          );
        }
        return place === null ? null : { partId, place };
      });
    },
    [setHunkComments],
  );

  const pointStates = usePoints(analysisId, view.pointReviews);

  // The host's conversation on the code, read live, beside the analysis.
  const threads = useThreads(analysisId, analysis.stages.prep === "done");
  const { post } = threads;
  const postCommentNow = useCallback(
    (id: PartId, comment: LineComment) => post({ hunkId: hunkIdOf(id), ...comment }),
    [post],
  );
  const placement = useMemo(
    () => placeThreads(threads.list?.threads ?? null, files, index),
    [threads.list, files, index],
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
      onResolve={(resolved) => threads.resolve(thread.id, resolved)}
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
  const currentHunk = (): PartId | null => (layout === "overview" ? null : focusedHunkId);

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
    if (point?.kind === "decision") {
      setDecisionsShown(() => true);
      setOpenDecisions((previous) => new Set([...previous, id]));
    }
    setHighlight(new Set((point?.hunkIds ?? []).flatMap(index.partsOf)));
    if (layout === "overview") {
      if (cardPart !== undefined) showHunk(cardPart);
    } else {
      scrollTo(pointAnchor(id));
    }
    setCurrentPoint(id);
  };
  /** Narrows the stepper to a kind, going to its first point unless the reviewer is on one. */
  const narrow = (kind: PointKind | null) => {
    setNarrowed(kind);
    const to = narrowTo(points, kind, currentPoint);
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
    setLayout(() => "overview");
    setOpenedFrom(null);
    if (path !== null) focusInOverview(path);
  };
  /** Opens a directory's or a file's first file in the map; outside, the code the node uses. */
  const openNode = (node: OverviewNode) => {
    const [path] = node.kind === "outside" ? [] : node.paths;
    const first =
      path === undefined
        ? node.partIds[0]
        : files.find((group) => group.file.path === path)?.partIds[0];
    if (first === undefined) return;
    setLayout(() => "map");
    setOpenedFrom(node.key);
    setFocusedHunkId(first);
    if (path === undefined) showHunk(first, "map");
    else scrollTo(fileAnchor(path));
  };
  const switchLayout = () => {
    if (layout === "map") return openOverview();
    const node = [...overview.rows.flat(), ...overview.strip].find(
      (one) => one.key === overviewAt.current,
    );
    if (node !== undefined && node.kind !== "outside") return openNode(node);
    setLayout(() => "map");
  };
  usePageDisplay({
    label: "Layout",
    options: LAYOUTS,
    value: layout,
    onChange: (next) => {
      if (next !== layout) switchLayout();
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
   * Raises a point: a comment on its lines with its text, its severity and its suggestion, which
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
      ...(point.severity === null ? {} : { severity: point.severity }),
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
    void pointStates.setState(point.id, "raised");
    if (add) return;
    const { startLine } = draft ?? place;
    setOpenComment({
      partId,
      place: {
        side: place.side,
        line: place.line,
        ...(startLine === undefined ? {} : { startLine }),
      },
    });
    scrollTo(hunkAnchor(partId));
  };
  const commentOnFocused = () => {
    // Comment on the focused hunk's first changed line.
    const current = currentHunk();
    const found = current === null ? undefined : index.parts.get(current);
    const line = found?.hunk.lines.find((one) => one.kind !== "context");
    if (!complete || found === undefined || line === undefined) return;
    const place = commentPlace(line);
    if (place !== null && current !== null) setOpenComment({ partId: current, place });
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
    if (layout === "map" && openedFrom !== null) {
      // Back to the overview, on the file the map was opened from.
      setLayout(() => "overview");
      setOverviewFocus((previous) => ({ key: openedFrom, n: (previous?.n ?? 0) + 1 }));
      setOpenedFrom(null);
    }
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

  // What publishing will post on the code: the reviewer's comments, raised points among them.
  const toPost = hunkComments.length;
  const totals = useMemo(() => changeTotals(analysis.files), [analysis.files]);
  const failureTitle =
    pointStates.failure === null
      ? ""
      : (points.find((point) => point.id === pointStates.failure?.pointId)?.title ?? "");

  const actionsOf = (point: Point): PointActions => ({
    state: pointStates.stateOf(point.id),
    saving: pointStates.isSaving(point.id),
    readOnly,
    current: currentPoint === point.id,
    onRaise: stable.raisePoint,
    onState: stable.setPointState,
  });
  /** A finding's card, with the lines its suggestion replaces and whether its draft is written. */
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
  const riskBand = (point: Point) => (
    <RiskBand key={point.id} point={point} {...actionsOf(point)} />
  );
  const decisionNote = (point: Point) => (
    <DecisionNote key={point.id} point={point} {...actionsOf(point)} />
  );
  /** A point by its kind, where no line of its part holds it. */
  const card = (point: Point, partId: PartId | null = null) =>
    point.kind === "finding"
      ? findingCard(point, partId)
      : point.kind === "risk"
        ? riskBand(point)
        : decisionsShown && decisionNote(point);
  // The lines each part's points rest on, so they take the kind's bar. Where points overlap,
  // the one that matters most wins: a finding's line reads as a finding. A point landing in view
  // gives its lines their place in the timeline.
  const pointLines = useMemo(() => {
    const rank: Readonly<Record<Point["kind"], number>> = { finding: 0, risk: 1, decision: 2 };
    const byPart = new Map<PartId, Map<string, PointLine>>();
    for (const [partId, placed] of places.cards) {
      const lines = new Map<string, PointLine>();
      for (const point of placed) {
        // A decision is a footnote, and marks no line.
        if (point.lines === null || point.kind === "decision") continue;
        const { side, startLine, line: last } = point.lines;
        const at = landingAt(point.id);
        for (let line = startLine; line <= last; line += 1) {
          const key = `${side}:${line}`;
          const held = lines.get(key);
          if (held !== undefined && rank[point.kind] >= rank[held.kind]) continue;
          lines.set(key, {
            kind: point.kind,
            ...(at === undefined
              ? {}
              : { landing: { at, line: line - startLine, lines: last - startLine + 1 } }),
          });
        }
      }
      if (lines.size > 0) byPart.set(partId, lines);
    }
    return byPart;
  }, [places, landingAt]);
  const pointLinesOf = useCallback((id: PartId) => pointLines.get(id), [pointLines]);
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
    return fold(
      [...cards, ...mentions],
      { bodyClassName: "flex flex-col gap-2 border-b bg-surface-subtle p-3" },
      <>
        {cards.map((point) => card(point, id))}
        {mentions.map((point) => (
          <PointMention key={point.id} point={point} onGo={stable.goToPoint} />
        ))}
      </>,
    );
  };
  // Findings under the last of their lines, which they grow out from when they land, and the
  // footnotes of the decisions at the end of the line, when opened.
  const pointsAt = (id: PartId, place: LinePlace): ReactNode => {
    const key = placeKey(place);
    const here = cardPlaces.underLine.get(id)?.get(key) ?? NO_POINTS;
    const notes = decisionsShown
      ? (cardPlaces.atLineEnd.get(id)?.get(key) ?? NO_POINTS).filter((point) =>
          openDecisions.has(point.id),
        )
      : NO_POINTS;
    return (
      <>
        {fold(
          here,
          {
            row: true,
            className: PINNED,
            bodyClassName: "flex max-w-3xl flex-col gap-2 py-2 pr-3 pl-29 font-sans",
          },
          here.map((point) => findingCard(point, id)),
        )}
        {notes.length > 0 && (
          <LineRow inset>
            <div className="flex flex-col gap-1">{notes.map(decisionNote)}</div>
          </LineRow>
        )}
      </>
    );
  };
  // A risk's band over the first of its lines, which lands as a finding's card does.
  const pointsOver = (id: PartId, place: LinePlace): ReactNode => {
    const here = cardPlaces.overLine.get(id)?.get(placeKey(place)) ?? NO_POINTS;
    return fold(here, { row: true, className: PINNED }, here.map(riskBand));
  };
  // A decision's chip at the end of its line.
  const pointsAtEnd = (id: PartId, place: LinePlace): ReactNode => {
    if (!decisionsShown) return null;
    const here = cardPlaces.atLineEnd.get(id)?.get(placeKey(place));
    if (here === undefined) return null;
    return here.map((point) => (
      <DecisionChip
        key={point.id}
        point={point}
        state={pointStates.stateOf(point.id)}
        open={openDecisions.has(point.id)}
        current={currentPoint === point.id}
        onToggle={toggleDecision}
      />
    ));
  };
  const flaggedOf = useCallback(
    (id: PartId): ReadonlySet<string> | undefined => {
      const lines = cardPlaces.underLine.get(id);
      return lines === undefined ? undefined : new Set(lines.keys());
    },
    [cardPlaces],
  );
  // Map cards render again only when their signature changes, so their handlers call the latest.
  const latest = useRef({ goToPoint, raisePoint });
  latest.current = { goToPoint, raisePoint };
  const stable = useMemo(
    () => ({
      goToPoint: (id: PointId) => latest.current.goToPoint(id),
      raisePoint: (point: Point, add: boolean) => latest.current.raisePoint(point, add),
      setPointState: pointStates.setState,
    }),
    [pointStates.setState],
  );
  const signatureOf = (id: PartId): string => {
    const parts: unknown[] = [
      epochOf(analysis),
      readOnly,
      highlight.has(id),
      openComment?.partId === id ? `${openComment.place.side}${openComment.place.line}` : "",
      ...commentsOf(id).map((comment) => JSON.stringify(comment)),
    ];
    // A part with threads draws again when they change.
    if (placement.onLine.has(id)) parts.push(epochOf(placement));
    const cards = places.cards.get(id) ?? NO_POINTS;
    const mentions = places.mentions.get(id) ?? NO_POINTS;
    for (const point of cards) {
      parts.push(point.id, pointStates.stateOf(point.id), pointStates.isSaving(point.id));
      parts.push(currentPoint === point.id);
      if (point.kind === "decision") parts.push(decisionsShown, openDecisions.has(point.id));
    }
    for (const point of mentions) parts.push(point.id);
    for (const point of [...cards, ...mentions]) {
      parts.push(landing.fresh(point.id), landingAt(point.id) ?? "");
    }
    return parts.join("\u0000");
  };
  const deps: HunkDeps = {
    index,
    unchangedOf,
    highlighted: highlight,
    commentsOf,
    openComment,
    onOpenComment: openCommentOn,
    // Line comments stay open once the review is published: they post now, on their own.
    onComment: complete ? writeComment : undefined,
    ...(complete ? { onCommentNow: postCommentNow } : {}),
    published: publication !== null,
    onFocusHunk: focusHunk,
    marksOf,
    pointsOn,
    pointsAt,
    pointsOver,
    pointsAtEnd,
    flaggedOf,
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
            places.unplaced.map((point) => card(point)),
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
        intent={
          <IntentLine
            analysis={live}
            running={landing.running}
            onDetails={() => {
              detailsReturnFocus.current = true;
              setShowDetails(true);
            }}
          />
        }
        totals={totals}
        threads={threads.list === null ? null : threadTotals(threads.list.threads)}
        now={Date.now()}
        reanalyzing={reanalyze.pending}
        reanalyzeError={reanalyze.error}
        onReanalyze={async () => {
          const result = await reanalyze.run({ url: prUrl });
          if (result.ok) open(result.value.analysisId);
        }}
      />
      <ReviewBar
        title={live.pullRequest?.title ?? null}
        claude={
          <ClaudeElement
            analysis={live}
            via={modelStatus?.via ?? null}
            running={landing.running}
            startedAt={modelStartedAt}
            starting={runModel.pending}
            error={runModel.error === null ? null : errorMessage(runModel.error)}
            points={points}
            narrowed={narrowed}
            onNarrow={narrow}
            decisionsShown={decisionsShown}
            onDecisionsShown={(shown) => setDecisionsShown(() => shown)}
            onRun={async () => {
              const result = await runModel.run(analysisId);
              if (!result.ok) return;
              setModelStartedAt(Date.now());
              follow();
            }}
          >
            <PointStepper
              points={points}
              current={currentPoint}
              stateOf={pointStates.stateOf}
              kind={narrowed}
              onGo={goToPoint}
              onOpenList={() => setShowPoints(true)}
            />
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
            <Button
              size="sm"
              data-slot="publish-button"
              className="shrink-0"
              onClick={() => void openPublish()}
            >
              Publish review…
              {toPost > 0 && (
                <span className="tabular rounded-full bg-primary-foreground px-1.5 text-caption text-primary">
                  {toPost}
                  <span className="sr-only"> to post</span>
                </span>
              )}
            </Button>
          )
        }
        publication={publication}
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
      ) : (
        <div>
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
          />
        </div>
      )}

      <UsageFooter usage={live.usage} />

      {publishing && (
        <PublishDialog
          analysisId={analysisId}
          hunkComments={hunkComments}
          isAuthor={view.isAuthor}
          onClose={() => setPublishing(false)}
          onPublished={() => {
            setPublishing(false);
            // The drafts are threads on the host now; read those instead of keeping both.
            setHunkComments(() => []);
            threads.reload();
            void refetch();
          }}
        />
      )}
      {showPoints && (
        <PointList
          points={points}
          kind={narrowed}
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
          <CheckoutNote analysis={analysis} />
        </Dialog>
      )}
      <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
        Press <KeyHint id="help" /> for keyboard shortcuts.
      </p>
    </div>
  );
};
