import { z } from "zod";

/** "h_" + 16 hex chars, with "-2", "-3"… appended on collision. Assigned by the diff parser. */
export const HunkId = z
  .string()
  .regex(/^h_[0-9a-f]{16}(-[2-9]|-[1-9][0-9]+)?$/)
  .brand<"HunkId">();
export type HunkId = z.infer<typeof HunkId>;

/**
 * A hunk ID for a hunk that isn't split, or a hunk ID and ".n" for part n of a split one
 * (h_0123456789abcdef.2). Every hunk ID is a part ID.
 */
export const PartId = z.union([
  HunkId,
  z
    .string()
    .regex(/^h_[0-9a-f]{16}(-[2-9]|-[1-9][0-9]+)?\.[1-9][0-9]*$/)
    .brand<"SplitPartId">(),
]);
export type PartId = z.infer<typeof PartId>;

export const FileStatus = z.enum(["added", "deleted", "modified", "renamed"]);
export type FileStatus = z.infer<typeof FileStatus>;

const LineNumber = z.number().int().positive();

export const DiffLine = z
  .object({
    kind: z.enum(["context", "add", "del"]),
    oldLine: LineNumber.nullable(),
    newLine: LineNumber.nullable(),
    text: z.string(),
    /** Set when the diff says "\ No newline at end of file" after this line. */
    noNewlineAtEnd: z.boolean(),
  })
  .readonly();
export type DiffLine = z.infer<typeof DiffLine>;

const LineCount = z.number().int().nonnegative();

export const Hunk = z
  .object({
    id: HunkId,
    path: z.string().min(1),
    oldStart: LineCount,
    oldLines: LineCount,
    newStart: LineCount,
    newLines: LineCount,
    sectionHeading: z.string().nullable(),
    lines: z.array(DiffLine).readonly(),
  })
  .readonly();
export type Hunk = z.infer<typeof Hunk>;

export const FileChange = z
  .object({
    /** The new path, or the old one for a deleted file. */
    path: z.string().min(1),
    oldPath: z.string().min(1).nullable(),
    status: FileStatus,
    binary: z.boolean(),
    /** Set only when the file mode changed. */
    oldMode: z.string().nullable(),
    newMode: z.string().nullable(),
    /** A tree-sitter language name, filled after parsing; null when unknown. */
    language: z.string().nullable(),
    hunks: z.array(Hunk).readonly(),
    additions: LineCount,
    deletions: LineCount,
  })
  .readonly();
export type FileChange = z.infer<typeof FileChange>;

export const MechanicalProofKind = z.enum([
  "generated",
  "whitespace",
  "rename",
  "move",
  "formatting",
]);
export type MechanicalProofKind = z.infer<typeof MechanicalProofKind>;

export const MechanicalProof = z
  .object({
    path: z.string().min(1),
    /** null for a file-level proof of a file with no hunks, such as a pure rename. */
    hunkId: HunkId.nullable(),
    kind: MechanicalProofKind,
    /** What was checked, for the reviewer: "moved from src/a.ts:10–42, identical". */
    detail: z.string().min(1),
  })
  .readonly();
export type MechanicalProof = z.infer<typeof MechanicalProof>;

/**
 * The lines of a split hunk that change one definition: `lines[start]` to `lines[end - 1]` of
 * hunk `hunkId`. `definitions` names what they change, outermost first.
 */
export const HunkPart = z
  .object({
    id: PartId,
    hunkId: HunkId,
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    definitions: z.array(z.string()).readonly(),
  })
  .readonly();
export type HunkPart = z.infer<typeof HunkPart>;

/**
 * The code in `fromPartId` references `symbol`, which `toPartId` defines or changes. `line` is the
 * new-side line of the first such reference in `fromPartId`. `use` says whether the code calls or
 * builds it, or only names it as a type; type uses group code but aren't followed as calls.
 */
export const CallGraphHint = z
  .object({
    fromPartId: PartId,
    toPartId: PartId,
    symbol: z.string().min(1),
    line: z.number().int().positive(),
    use: z.enum(["call", "type"]),
  })
  .readonly();
export type CallGraphHint = z.infer<typeof CallGraphHint>;
