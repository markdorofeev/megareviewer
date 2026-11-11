import { Fragment, memo, type ReactNode, useEffect } from "react";
import type { MechanicalProof, PartId } from "../../../../src/domain/diff/index.ts";
import { type Analysis, pathReasons } from "../../../../src/domain/review/index.ts";
import {
  FileNotices,
  FilePath,
  FileStatusChip,
  lineCounts,
  MechanicalGroup,
} from "../../review/index.ts";
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

/** A part's place on its file's card: its anchor, and its lines, drawn again only when they change. */
const MapPart = ({
  id,
  deps,
  signatureOf,
}: {
  readonly id: PartId;
  readonly deps: HunkDeps;
  readonly signatureOf: (id: PartId) => string;
}) => (
  <div id={hunkAnchor(id)} className="scroll-mt-24 border-t first:border-t-0" data-hunk-id={id}>
    <Stable signature={signatureOf(id)} render={() => <HunkView id={id} deps={deps} />} />
  </div>
);

/** Arrows apart from a line: lines folded away here. */
const UnfoldIcon = () => (
  <svg
    data-slot="unfold-icon"
    className="shrink-0"
    viewBox="0 0 16 16"
    width="16"
    height="16"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M8 1.5v4M5.5 3.5 8 1l2.5 2.5M8 14.5v-4M5.5 12.5 8 15l2.5-2.5M2 8h12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** The unchanged lines between two parts on a card, folded: how many, under an unfold icon. */
const GapRow = ({ lines }: { readonly lines: number }) =>
  lines === 0 ? null : (
    <div
      data-slot="file-gap"
      className="flex h-8 items-center gap-2 border-t bg-surface-subtle px-3 text-muted-foreground"
    >
      <UnfoldIcon />
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
  group,
  deps,
  signatureOf,
}: {
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
        return (
          <Fragment key={id}>
            {gap !== null && <GapRow lines={gap} />}
            <MapPart id={id} deps={deps} signatureOf={signatureOf} />
          </Fragment>
        );
      })}
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
        <FileCard key={group.file.path} group={group} deps={deps} signatureOf={signatureOf} />
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
