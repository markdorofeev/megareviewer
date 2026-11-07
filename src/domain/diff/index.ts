export { buildCallGraphHints, changedDefinitionNames, type FileSymbols } from "./call-graph.ts";
export { FileLink, fileLinks } from "./file-links.ts";
export { findFormattingProofs } from "./formatting.ts";
export { hunkId } from "./hunk-id.ts";
export type { SymbolImport } from "./imports.ts";
export { type DiffParseError, parseUnifiedDiff } from "./parse-diff.ts";
export {
  type DefinitionSpan,
  type FileDefinitions,
  hunkIdOf,
  type Piece,
  partHunk,
  partId,
  partsByHunk,
  piecesOf,
  renameHints,
  splitByDefinition,
  splitHunks,
} from "./parts.ts";
export { findMechanicalProofs, type ProofContext } from "./proofs.ts";
export { isTestFile } from "./test-files.ts";
export {
  CallGraphHint,
  DiffLine,
  FileChange,
  FileStatus,
  Hunk,
  HunkId,
  HunkPart,
  MechanicalProof,
  MechanicalProofKind,
  PartId,
} from "./types.ts";
export { lockfileWarnings } from "./warnings.ts";
