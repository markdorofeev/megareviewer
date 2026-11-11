// The review page's components on the Indigo Calm design system. Shown on /design-system.html for
// now; the review page moves to them later.

export { type Density, DiffLine } from "./diff/diff-line.tsx";
export { type DiffView, DiffViewer, type DiffViewerProps } from "./diff/diff-viewer.tsx";
export { FilePath, FileStatusChip, UnchangedUses } from "./diff/file-path.tsx";
export {
  commentPlace,
  HunkCard,
  type HunkCardProps,
  type HunkItem,
  type LineComment,
  type LinePlace,
} from "./diff/hunk-card.tsx";
export {
  CollapsedHunk,
  EXPAND_STEP,
  type ExpandDirection,
  HunkHeader,
} from "./diff/hunk-header.tsx";
export { hunkLocation, lineCounts } from "./diff/lines.ts";
export {
  FileNotices,
  MECHANICAL_LINE_LIMIT,
  MechanicalGroup,
  MechanicalHunk,
} from "./diff/mechanical-group.tsx";
export type { ViewLine } from "./diff/rows.ts";
export {
  createShikiHighlighter,
  type Highlighter,
  HighlighterContext,
  type SyntaxToken,
  useFileTokens,
  useHunkTokens,
  useSyntax,
} from "./diff/syntax.ts";
export { type UnchangedLine, UnchangedLines } from "./diff/unchanged-lines.tsx";
export { CommentComposer } from "./pr/comment-composer.tsx";
export { PrHeader, type PrSummary, type PrTab } from "./pr/pr-header.tsx";
export {
  type PendingComment,
  ReviewSubmitForm,
  ReviewSubmitPanel,
} from "./pr/review-submit-panel.tsx";
export { DANGER, WARNING } from "./shell/banners.ts";
export { DiffSkeleton, EmptyState, TreeSkeleton } from "./shell/empty-state.tsx";
export { KeyHint } from "./shell/key-hint.tsx";
export { ShortcutsDialog } from "./shell/shortcuts-dialog.tsx";
export { ContractCount, FileRow, FileTree } from "./tree/file-tree.tsx";
export type { FileEntry } from "./tree/files.ts";
export {
  byTreePath,
  directoryOf,
  fileTree,
  nameOf,
  type TreeEntry,
  treeOrder,
} from "./tree/paths.ts";
export { type Neighbors, type Relation, relationOf } from "./tree/relations.ts";
