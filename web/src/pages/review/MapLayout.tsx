import { Fragment, memo, type ReactNode, useEffect } from "react";
import type { MechanicalProof, PartId } from "../../../../src/domain/diff/index.ts";
import { type Analysis, pathReasons } from "../../../../src/domain/review/index.ts";
import {
  FileNotices,
  FilePath,
  FileStatusBadge,
  lineCounts,
  MechanicalGroup,
} from "../../diff/index.ts";
import { type HunkDeps, HunkView, hunkAnchor } from "./HunkView.tsx";
import { type FileGroup, gapBetween } from "./model.ts";

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
  <div id={hunkAnchor(id)} className="map-hunk" data-hunk-id={id}>
    <Stable signature={signatureOf(id)} render={() => <HunkView id={id} deps={deps} />} />
  </div>
);

/** Arrows apart from a line: lines folded away here. */
const UnfoldIcon = () => (
  <svg
    className="unfold-icon"
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
    <div className="file-gap folded">
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
  const contract = items.filter(
    (item) => !deps.index.mechanical.has(item.id) && item.risk.riskClass === "contract",
  ).length;
  // A path rule holds for every part of the file, so its reason is said once, here.
  const fileReasons = contract > 0 ? pathReasons(group.file) : [];
  return (
    <section
      id={fileAnchor(group.file.path)}
      className={contract > 0 ? "file-card risk-contract" : "file-card"}
      aria-label={group.file.path}
      tabIndex={-1}
    >
      <header className="file-card-header">
        <FilePath file={group.file} />
        {/* Nearly every file is modified, so only the other statuses are worth a badge. */}
        {group.file.status !== "modified" && <FileStatusBadge status={group.file.status} />}
        <span className="hunk-counts">
          {fileReasons.length > 0 && (
            <span className="file-card-reason">{fileReasons.join("; ")} · </span>
          )}
          {contract > 0 && <span className="count-contract">{contract} contract · </span>}
          <span className="count-added">+{added}</span>{" "}
          <span className="count-deleted">−{deleted}</span>
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
    const focusable =
      target.querySelector<HTMLElement>(":scope > .hunk-card, :scope > div > .mechanical-toggle") ??
      target;
    const decision = target.classList.contains("decision");
    target.scrollIntoView({ block: decision ? "center" : "start" });
    focusable.focus({ preventScroll: true });
  }, [scrollRequest]);

  return (
    <section className="main-area map" aria-label="Changes">
      {before}
      {files.map((group) => (
        <FileCard key={group.file.path} group={group} deps={deps} signatureOf={signatureOf} />
      ))}
      <div id={MECHANICAL_ANCHOR} className="map-mechanical" tabIndex={-1}>
        {mechanicalCount === 0 && analysis.stages.prep === "done" && (
          <p className="muted">No mechanical changes in this pull request.</p>
        )}
        <MechanicalGroup files={analysis.files} proofs={trailingProofs} risk={analysis.risk} />
        <FileNotices files={analysis.files} />
      </div>
    </section>
  );
};
