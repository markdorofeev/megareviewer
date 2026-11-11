import { Fragment, memo, type ReactNode, useEffect, useMemo, useState } from "react";
import type { MechanicalProof, PartId } from "../../../../src/domain/diff/index.ts";
import {
  type Analysis,
  type AnalysisId,
  pathReasons,
} from "../../../../src/domain/review/index.ts";
import { cn } from "../../lib/utils.ts";
import {
  FileNotices,
  FilePath,
  FileStatusChip,
  lineCounts,
  MechanicalGroup,
} from "../../review/index.ts";
import { FoldView, useFileText } from "./FoldView.tsx";
import { canOpen, type Fold, foldsOf } from "./folds.ts";
import { type HunkDeps, HunkView, hunkAnchor } from "./HunkView.tsx";
import { contractParts, type FileGroup, gapBetween } from "./model.ts";

export const MECHANICAL_ANCHOR = "mechanical-changes";

/** Where the map scrolls to. `n` changes on every request, so asking twice scrolls twice. */
export interface ScrollRequest {
  readonly id: string;
  readonly n: number;
}

/** The anchor of a file's card. */
export const fileAnchor = (path: string): string => `file-${path}`;

/**
 * Renders again only when `signature` changes, so a long PR's cards don't all redraw on every key.
 * The signature has to cover everything the card shows, and its handlers have to stay current.
 */
const Stable = memo(
  function Stable({ render }: { readonly signature: string; readonly render: () => ReactNode }) {
    return render();
  },
  (previous, next) => previous.signature === next.signature,
);

/**
 * A part's place on its file's card: its anchor, and its lines, drawn again only when they change.
 * A part that goes on from the line before it has no border, so the lines run on as in the diff.
 */
const MapPart = ({
  id,
  joined,
  deps,
  signatureOf,
}: {
  readonly id: PartId;
  readonly joined: boolean;
  readonly deps: HunkDeps;
  readonly signatureOf: (id: PartId) => string;
}) => (
  <div
    id={hunkAnchor(id)}
    className={cn("scroll-mt-24", !joined && "border-t first:border-t-0")}
    data-hunk-id={id}
  >
    <Stable signature={signatureOf(id)} render={() => <HunkView id={id} deps={deps} />} />
  </div>
);

/** The unchanged lines between two parts of a file that can't be opened: how many. */
const GapRow = ({ lines }: { readonly lines: number }) =>
  lines === 0 ? null : (
    <div
      data-slot="file-gap"
      className="flex h-8 items-center gap-2 border-t bg-surface-subtle px-3 text-muted-foreground"
    >
      <span>
        {lines} {lines === 1 ? "line" : "lines"} unchanged
      </span>
    </div>
  );

/**
 * A file's parts on one card: the file once in its header, and each part under a divider of its
 * own when it has something to say, the lines between them folded.
 */
const FileCard = ({
  analysisId,
  group,
  deps,
  signatureOf,
}: {
  readonly analysisId: AnalysisId;
  readonly group: FileGroup;
  readonly deps: HunkDeps;
  readonly signatureOf: (id: PartId) => string;
}) => {
  const items = deps.index.items(group.partIds);
  const added = items.reduce((sum, item) => sum + lineCounts(item.hunk).added, 0);
  const deleted = items.reduce((sum, item) => sum + lineCounts(item.hunk).deleted, 0);
  const contract = contractParts(group, deps.index);
  // A path rule holds for every part of the file, so its reason is said once, here.
  const fileReasons = contract > 0 ? pathReasons(group.file) : [];
  const { text, load } = useFileText(analysisId, group.file.path);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const folds = useMemo(
    () => (canOpen(group.file) ? foldsOf(group.partIds, deps.index) : []),
    [group, deps.index],
  );
  const foldKey = (fold: Fold) => `${fold.after ?? ""}>${fold.before ?? ""}`;
  const foldView = (fold: Fold) => {
    const key = foldKey(fold);
    const next = fold.before ?? fold.after;
    const neighbor = next === null ? undefined : deps.index.parts.get(next);
    if (neighbor === undefined) return null;
    return (
      <FoldView
        key={key}
        fold={fold}
        file={group.file}
        hunkId={neighbor.hunk.id}
        opened={opened.has(key)}
        text={text}
        above={fold.after !== null}
        below={fold.before !== null}
        onOpen={() => {
          load();
          setOpened((previous) => new Set(previous).add(key));
        }}
      />
    );
  };
  return (
    <section
      id={fileAnchor(group.file.path)}
      data-slot="file-card"
      data-risk={contract > 0 ? "contract" : undefined}
      className="scroll-mt-2 rounded-lg border bg-card -outline-offset-2"
      aria-label={group.file.path}
      data-path={group.file.path}
      tabIndex={-1}
    >
      <header
        data-slot="file-card-header"
        className="sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-t-lg border-b bg-card px-3 py-2"
      >
        <FilePath file={group.file} className="min-w-0 flex-1" />
        <FileStatusChip status={group.file.status} />
        <span className="tabular flex flex-wrap items-center gap-x-1.5 text-caption">
          {fileReasons.length > 0 && (
            <span className="text-muted-foreground">{fileReasons.join("; ")} · </span>
          )}
          {contract > 0 && (
            <span data-slot="count-contract" className="font-medium text-risk-contract">
              <span aria-hidden="true">▲ </span>
              {contract} contract ·{" "}
            </span>
          )}
          <span className="font-mono text-code-compact">
            <span className="text-diff-add-fg">+{added}</span>{" "}
            <span className="text-diff-del-fg">−{deleted}</span>
          </span>
        </span>
      </header>
      {group.partIds.map((id, at) => {
        const previous = group.partIds[at - 1];
        const gap = previous === undefined ? null : gapBetween(previous, id, deps.index);
        const fold = folds.find((one) => one.before === id);
        return (
          <Fragment key={id}>
            {fold === undefined ? gap !== null && <GapRow lines={gap} /> : foldView(fold)}
            {/* After a fold its row or its opened lines lead in, so the part needs no border. */}
            <MapPart
              id={id}
              joined={gap === 0 || fold !== undefined}
              deps={deps}
              signatureOf={signatureOf}
            />
          </Fragment>
        );
      })}
      {folds.filter((fold) => fold.before === null).map(foldView)}
    </section>
  );
};

/** Every changed file in one scroll, a card each, in path order, then the mechanical changes. */
export const MapLayout = ({
  analysis,
  files,
  deps,
  before,
  trailingProofs,
  mechanicalCount,
  scrollRequest,
  signatureOf,
}: {
  readonly analysis: Analysis;
  readonly files: readonly FileGroup[];
  readonly deps: HunkDeps;
  /** Shown before the first file, e.g. decisions on no hunk. */
  readonly before: ReactNode;
  readonly trailingProofs: readonly MechanicalProof[];
  readonly mechanicalCount: number;
  readonly scrollRequest: ScrollRequest | null;
  /** What a part's place shows, as a string that changes whenever that does. */
  readonly signatureOf: (id: PartId) => string;
}) => {
  useEffect(() => {
    if (scrollRequest === null) return;
    const target = document.getElementById(scrollRequest.id);
    if (target === null) return;
    // A part's lines or collapsed row take the focus, so a, r and c act on what's shown.
    // A part's place holds its card or its collapsed row; a file card or a decision is itself.
    const focusable =
      (target.dataset.hunkId === undefined
        ? null
        : target.querySelector<HTMLElement>(
            "[data-slot=hunk-card], [data-slot=mechanical-toggle]",
          )) ?? target;
    const decision = target.dataset.slot === "decision";
    target.scrollIntoView({ block: decision ? "center" : "start" });
    focusable.focus({ preventScroll: true });
  }, [scrollRequest]);

  return (
    <section className="flex min-w-0 flex-col gap-4" aria-label="Changes">
      {before}
      {files.map((group) => (
        <FileCard
          key={group.file.path}
          analysisId={analysis.id}
          group={group}
          deps={deps}
          signatureOf={signatureOf}
        />
      ))}
      <div
        id={MECHANICAL_ANCHOR}
        className="flex scroll-mt-2 flex-col gap-4 -outline-offset-2"
        tabIndex={-1}
      >
        {mechanicalCount === 0 && analysis.stages.prep === "done" && (
          <p className="text-muted-foreground">No mechanical changes in this pull request.</p>
        )}
        <MechanicalGroup files={analysis.files} proofs={trailingProofs} risk={analysis.risk} />
        <FileNotices files={analysis.files} />
      </div>
    </section>
  );
};
