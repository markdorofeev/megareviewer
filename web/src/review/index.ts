// The review page's components on the Indigo Calm design system. Shown on /design-system.html for
// now; the review page moves to them later.

export {
  type CallPayload,
  CallPeek,
  type CallPeekHandle,
  type CallTarget,
  CallTrigger,
  createCallPeekHandle,
} from "./diff/call-peek.tsx";
export { type Density, DiffLine, type LineMark, type PointLanding } from "./diff/diff-line.tsx";
export { type DiffView, DiffViewer, type DiffViewerProps } from "./diff/diff-viewer.tsx";
export { FilePath, FileStatusChip, UnchangedUses } from "./diff/file-path.tsx";
export {
  commentPlace,
  HunkCard,
  type HunkCardProps,
  type HunkItem,
  type LineComment,
  type LinePlace,
  LineRow,
  PINNED,
  type PointLine,
} from "./diff/hunk-card.tsx";
export {
  CollapsedHunk,
  type ExpandDirection,
  HunkHeader,
} from "./diff/hunk-header.tsx";
export { languageOf } from "./diff/languages.ts";
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
export { KeyHint, KeyHintLine } from "./shell/key-hint.tsx";
export { ShortcutsDialog } from "./shell/shortcuts-dialog.tsx";
export {
  CommentCard,
  type CommentState,
  initialsOf,
  type ReviewThreadProps,
  ReviewThreadView,
  relativeTime,
  SuggestionDiff,
  ThreadBody,
  threadPlace,
} from "./thread/index.ts";
export { ContractCount, FileRow, FileTree, PointCounts, ThreadCount } from "./tree/file-tree.tsx";
export type { FileEntry } from "./tree/files.ts";
export {
  byTreePath,
  directoryOf,
  fileTree,
  nameOf,
  type TreeEntry,
  treeOrder,
} from "./tree/paths.ts";
