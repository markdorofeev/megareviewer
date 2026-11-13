import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import type { AnalysisView } from "../../../../contracts/index.ts";
import { hunkIdOf, type PartId, type UnchangedCallers } from "../../../../src/domain/diff/index.ts";
import {
  type AnalysisId,
  type Decision,
  type DecisionId,
  HunkComment,
  pullRequestUrl,
  type ReviewThread,
} from "../../../../src/domain/review/index.ts";
import { errorMessage, useAnalysisView, useApi, useMutation, useStatus } from "../../api/index.ts";
import { Link } from "../../app/Link.tsx";
import { navigate, reviewPath } from "../../app/router.ts";
import { type ShortcutHandlers, type ShortcutId, useShortcuts } from "../../lib/keymap.ts";
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
  languageOf,
  ReviewThreadView,
  ShortcutsDialog,
  TreeSkeleton,
  threadPlace,
  WARNING,
} from "../../review/index.ts";
import { Button } from "../../ui/button.tsx";
import { Skeleton } from "../../ui/skeleton.tsx";
import { callMarks } from "./calls.tsx";
import { DecisionCard, DecisionMention, decisionAnchor } from "./DecisionCard.tsx";
import { Dialog } from "./Dialog.tsx";
import { type HunkDeps, hunkAnchor } from "./HunkView.tsx";
import { IntentLine } from "./IntentLine.tsx";
import { IntentPanel } from "./IntentPanel.tsx";
import { fileAnchor, MapLayout, MECHANICAL_ANCHOR, type ScrollRequest } from "./MapLayout.tsx";
import {
  commentsInParts,
  contractParts,
  decisionPlaces,
  type Layout,
  mapFiles,
  mechanicalCount,
  parseLayout,
  partIndex,
  tourSteps,
  trailingProofs,
} from "./model.ts";
import { Overview } from "./Overview.tsx";
import { fileOverview, type OverviewNode } from "./overview.ts";
import { ProgressStrip, stageName } from "./ProgressStrip.tsx";
import { PublishDialog } from "./PublishDialog.tsx";
import { Rail } from "./Rail.tsx";
import { ReviewHeader } from "./ReviewHeader.tsx";
import { Segmented } from "./Segmented.tsx";
import { StatedIntent } from "./StatedIntent.tsx";
import { useStoredState } from "./storage.ts";
import { coveredLines, placeKey, placeThreads } from "./threads.ts";
import { UsageFooter } from "./UsageFooter.tsx";
import { useFileInView } from "./useFileInView.ts";
import { useThreads } from "./useThreads.ts";
import { useVerdicts } from "./useVerdicts.ts";

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
  const { view, error, refetch } = useAnalysisView(analysisId);
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
  return <Review view={view} refetch={refetch} restart={restart} />;
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

const NO_DECISIONS: readonly Decision[] = [];

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
  "approveDecision",
  "rejectDecision",
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
  restart,
}: {
  readonly view: AnalysisView;
  readonly refetch: () => Promise<void>;
  readonly restart: () => void;
}) => {
  const { client } = useApi();
  // Until the status says otherwise, a missing intent is still coming from the model.
  const modelOn = useStatus().status?.model.enabled !== false;
  const { analysis, publication } = view;
  const analysisId = analysis.id;
  const complete = analysis.status === "complete";
  const readOnly = publication !== null || !complete;

  const index = useMemo(() => partIndex(analysis), [analysis]);
  const steps = useMemo(() => tourSteps(analysis, index), [analysis, index]);
  const files = useMemo(() => mapFiles(analysis, index), [analysis, index]);
  const order = useMemo(() => files.flatMap((group) => group.partIds), [files]);
  const trailing = useMemo(() => trailingProofs(analysis, index), [analysis, index]);
  const mechanical = mechanicalCount(trailing);
  const places = useMemo(
    () => decisionPlaces(analysis.decisions, order, index),
    [analysis.decisions, order, index],
  );
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
      })),
    [files, contractOf],
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
  const [selectedDecision, setSelectedDecision] = useState<DecisionId | null>(null);
  // The hunks of a decision or mismatch the reviewer went to.
  const [highlight, setHighlight] = useState<ReadonlySet<PartId>>(new Set());
  const [mismatchAt, setMismatchAt] = useState(0);
  const [scrollRequest, setScrollRequest] = useState<ScrollRequest | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const detailsReturnFocus = useRef(true);
  const [showDetails, setShowDetails] = useState(false);
  const commentField = useRef<HTMLTextAreaElement | null>(null);
  const setCommentField = useCallback((field: HTMLTextAreaElement | null) => {
    commentField.current = field;
  }, []);

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

  const verdicts = useVerdicts(analysisId, view.verdicts);

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

  /** A decision's card goes with the hunk the reviewer is on, for a, r and c. */
  const focusHunk = useCallback(
    (id: PartId) => {
      setFocusedHunkId(id);
      const cards = places.cards.get(id) ?? NO_DECISIONS;
      setSelectedDecision((previous) =>
        cards.some((decision) => decision.id === previous) ? previous : (cards[0]?.id ?? null),
      );
    },
    [places],
  );
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
  const goToDecision = (id: DecisionId) => {
    const decision = analysis.decisions.find((one) => one.id === id);
    const cardHunk = places.cardHunk.get(id);
    setHighlight(new Set((decision?.hunkIds ?? []).flatMap(index.partsOf)));
    if (layout === "overview") {
      if (cardHunk !== undefined) showHunk(cardHunk);
    } else {
      scrollTo(decisionAnchor(id));
    }
    setSelectedDecision(id);
  };
  const goToMismatch = (at: number) => {
    const mismatch = analysis.intent?.mismatches[at];
    if (mismatch === undefined) return;
    const ids = mismatch.hunkIds
      .flatMap(index.partsOf)
      .sort((a, b) => order.indexOf(a) - order.indexOf(b));
    setHighlight(new Set(ids));
    setMismatchAt(at + 1);
    const [first] = ids;
    if (first !== undefined) showHunk(first);
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

  const toggleVerdict = (id: DecisionId, verdict: "approved" | "rejected") => {
    if (readOnly) return;
    const current = verdicts.draftOf(id).verdict;
    verdicts.setVerdict(id, current === verdict ? "pending" : verdict);
  };
  const commentOnFocused = () => {
    if (selectedDecision !== null && commentField.current !== null) {
      commentField.current.focus();
      return;
    }
    // Without a decision selected, comment on the hunk's first changed line.
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
  // Something to post: decisions the model made, or comments on lines.
  const canPublish = analysis.decisions.length > 0 || hunkComments.length > 0;
  // The overview handles its own arrows and Enter, on the file that has the focus.
  const mapOnly: ShortcutHandlers = {
    nextFile: () => moveFile(1),
    previousFile: () => moveFile(-1),
    approveDecision: () => {
      if (selectedDecision !== null) toggleVerdict(selectedDecision, "approved");
    },
    rejectDecision: () => {
      if (selectedDecision !== null) toggleVerdict(selectedDecision, "rejected");
    },
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

  const openPublish = async () => {
    await verdicts.flush();
    setPublishing(true);
  };

  // What publishing will post on the code: decided or commented decisions, and line comments.
  const toPost =
    analysis.decisions.filter((decision) => {
      const draft = verdicts.draftOf(decision.id);
      return draft.verdict !== "pending" || draft.comment.trim() !== "";
    }).length + hunkComments.length;
  const publishShown = view.publication === null && canPublish;
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
  const decisionsOn = (id: PartId): ReactNode => {
    const cards = places.cards.get(id) ?? NO_DECISIONS;
    const mentions = places.mentions.get(id) ?? NO_DECISIONS;
    if (cards.length === 0 && mentions.length === 0) return null;
    return (
      <div className="flex flex-col gap-2 border-b bg-surface-subtle p-3">
        {cards.map(card)}
        {mentions.map((decision) => (
          <DecisionMention key={decision.id} decision={decision} onGo={stable.goToDecision} />
        ))}
      </div>
    );
  };
  // Map cards render again only when their signature changes, so their handlers call the latest.
  const latest = useRef({ goToDecision });
  latest.current = { goToDecision };
  const stable = useMemo(
    () => ({ goToDecision: (id: DecisionId) => latest.current.goToDecision(id) }),
    [],
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
    for (const decision of places.cards.get(id) ?? NO_DECISIONS) {
      const draft = verdicts.draftOf(decision.id);
      parts.push(decision.id, draft.verdict, draft.comment, verdicts.statusOf(decision.id));
      parts.push(selectedDecision === decision.id);
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
    decisionsOn,
    threadsAt,
    earlierThreads,
    openThreads,
    ...(RANGE_NOTES[analysis.key.ref.repo.host] === undefined
      ? {}
      : { rangeNote: RANGE_NOTES[analysis.key.ref.repo.host] }),
  };
  const before = (
    <>
      {modelOn && analysis.status === "running" && analysis.stages.decisions !== "done" && (
        <p className="text-muted-foreground">Finding the decisions the code makes…</p>
      )}
      {analysis.stages.decisions === "done" &&
        !complete &&
        publication === null &&
        analysis.decisions.length > 0 && (
          <p className="text-muted-foreground">
            You can give verdicts once the analysis is complete.
          </p>
        )}
      {places.unplaced.length > 0 && (
        <section className="flex flex-col gap-2" aria-label="Decisions on no change shown here">
          {places.unplaced.map(card)}
        </section>
      )}
    </>
  );

  return (
    <div
      data-layout={layout}
      // Room under the last of the page for the floating Publish button.
      className={cn("mx-auto flex max-w-[1600px] flex-col gap-4", publishShown && "pb-20")}
    >
      <ReviewHeader
        view={view}
        intent={
          <IntentLine
            analysis={analysis}
            modelOn={modelOn}
            mismatchAt={mismatchAt}
            onMismatch={goToMismatch}
            onDetails={() => {
              detailsReturnFocus.current = true;
              setShowDetails(true);
            }}
          />
        }
        tools={
          <>
            {layout === "map" && (
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
            )}
            <Segmented
              legend="Layout"
              options={LAYOUTS}
              value={layout}
              onChange={(next) => {
                if (next !== layout) switchLayout();
              }}
            />
          </>
        }
        reanalyzing={reanalyze.pending}
        reanalyzeError={reanalyze.error}
        onReanalyze={async () => {
          const result = await reanalyze.run({ url: prUrl });
          if (result.ok) open(result.value.analysisId);
        }}
      />

      {!complete && <ProgressStrip stages={analysis.stages} filesFetched={analysis.filesFetched} />}
      {analysis.error !== null && (
        <div className={cn(DANGER, "flex flex-col items-start gap-2")} role="alert">
          <p>
            The analysis failed at the {stageName(analysis.error.stage).toLowerCase()} stage:{" "}
            {analysis.error.message}
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
      {verdicts.failure !== null && (
        <div
          className={cn(DANGER, "flex flex-wrap items-center justify-between gap-2")}
          role="alert"
        >
          <p>
            Couldn't save your {verdicts.failure.what} on “{failureTitle}”.{" "}
            {verdicts.failure.message}
          </p>
          <Button variant="ghost" size="sm" onClick={verdicts.dismissFailure}>
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

      <UsageFooter usage={analysis.usage} />

      {publishShown && (
        // Floats at the bottom right, so the review can be published from anywhere in the scroll.
        <Button
          size="lg"
          data-slot="publish-button"
          disabled={!complete}
          onClick={() => void openPublish()}
          className="fixed right-6 bottom-6 z-40 rounded-full px-4 shadow-lg"
        >
          Publish review…
          {toPost > 0 && (
            <span className="tabular rounded-full bg-primary-foreground px-1.5 text-caption text-primary">
              {toPost}
              <span className="sr-only"> to post</span>
            </span>
          )}
          <KeyHint id="openReview" />
        </Button>
      )}

      {publishing && (
        <PublishDialog
          analysisId={analysisId}
          hunkComments={hunkComments}
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
