import { z } from "zod";
import { type FileChange, type Hunk, HunkId, hunkHasLine } from "../diff/index.ts";
import { Guardrail, StoredGuardrail } from "./guardrail.ts";
import { type Intent, IntentMismatchKind } from "./intent.ts";
import { PointLines } from "./point-lines.ts";
import {
  type Guidance,
  GuidanceEffect,
  GuidanceMark,
  PreferenceId,
  resolveGuidanceMark,
} from "./preference.ts";
import { Timestamp } from "./primitives.ts";

export { PointLines };

/** "f1", "f2", … in the order the model listed the findings. */
export const FindingId = z
  .string()
  .regex(/^f[1-9][0-9]*$/)
  .brand<"FindingId">();
export type FindingId = z.infer<typeof FindingId>;

/** "m1" for the intent's first mismatch, in its order. */
export const MismatchId = z
  .string()
  .regex(/^m[1-9][0-9]*$/)
  .brand<"MismatchId">();
export type MismatchId = z.infer<typeof MismatchId>;

/**
 * How much Claude thinks a finding matters, while it's Claude's: a comment the reviewer adds to
 * the review carries none.
 */
export const Severity = z.enum(["minor", "major", "blocking"]);
export type Severity = z.infer<typeof Severity>;

/**
 * What a finding is about. logic: the code does the wrong thing. contract: the change breaks or
 * exposes something outside the PR. architecture: it's built in the wrong place or the wrong way
 * for the code the PR shows. Not a hunk's risk class, which a path rule or a proof decides.
 */
export const FindingType = z.enum(["logic", "contract", "architecture"]);
export type FindingType = z.infer<typeof FindingType>;

/** Something in the code that looks wrong, on the lines it rests on: a draft comment. */
export const Finding = z
  .object({
    id: FindingId,
    title: z.string().min(1),
    explanation: z.string(),
    lines: PointLines,
    /** Logic for a finding stored before findings had a type, when that's all there was. */
    type: FindingType.default("logic"),
    severity: Severity.default("major"),
    /** The new-side lines that replace the ones it rests on; null when it suggests none. */
    suggestion: z.array(z.string()).readonly().nullable().default(null),
    /** The intent mismatch it shows, which then isn't a point of its own. */
    mismatch: MismatchId.nullable().default(null),
    /** The preference or guideline file that raised it or says to leave it out, as the model marks it. */
    guidance: GuidanceMark.nullable().default(null),
    /** A check that could catch its kind, as the guardrail call marked it. */
    guardrail: StoredGuardrail,
  })
  .readonly();
export type Finding = z.infer<typeof Finding>;

/**
 * A finding's ID, or "m1" for the first intent mismatch. Reviews stored while risks and decisions
 * were points have "r:" and a hunk's ID, or "d1".
 */
export const PointId = z
  .string()
  .regex(/^([fmd][1-9][0-9]*|r:h_[0-9a-f]{16}(-[2-9]|-[1-9][0-9]+)?)$/)
  .brand<"PointId">();
export type PointId = z.infer<typeof PointId>;

/** What the model asks the reviewer to look at: a finding, or a mismatch no finding names. */
export const Point = z
  .object({
    id: PointId,
    title: z.string().min(1),
    explanation: z.string(),
    /** The file of `lines`; null with them. */
    path: z.string().nullable(),
    /** Where the point lands in the code; null for a mismatch the model tied to no hunk. */
    lines: PointLines.nullable(),
    /** Every hunk the point rests on, `lines`' first. */
    hunkIds: z.array(HunkId).readonly(),
    /** A finding's; null for a mismatch no finding names. */
    type: FindingType.nullable(),
    /** A finding's severity; null for a mismatch no finding names. */
    severity: Severity.nullable(),
    /** A finding's suggested lines, in place of `lines`. */
    suggestion: z.array(z.string()).readonly().nullable(),
    /** The intent mismatch a finding shows. */
    mismatch: z.object({ kind: IntentMismatchKind, description: z.string() }).readonly().nullable(),
    /**
     * The preference or guideline file that shaped a finding, by its text or its path; left-out is
     * one the reviewer asked not to be flagged, which the page folds.
     */
    guidance: z
      .object({
        effect: GuidanceEffect,
        label: z.string(),
        preferenceId: PreferenceId.nullable(),
        everywhere: z.boolean(),
      })
      .readonly()
      .optional(),
    /** On a finding: a check that could catch its kind. */
    guardrail: Guardrail.optional(),
  })
  .readonly();
export type Point = z.infer<typeof Point>;

/** open: not acted on, which means fine. raised: a comment was opened on it. dismissed: folded. */
export const PointState = z.enum(["open", "raised", "dismissed"]);
export type PointState = z.infer<typeof PointState>;

export const PointReview = z
  .object({ pointId: PointId, state: PointState, updatedAt: Timestamp })
  .readonly();
export type PointReview = z.infer<typeof PointReview>;

const MISMATCH_EXPLANATION: Readonly<Record<IntentMismatchKind, string>> = {
  missing: "Asked for, not done.",
  unrequested: "Done, not asked for.",
  contradicts: "Contradicts what was asked.",
};

/** A hunk's changed lines: its added lines on the new side, or its deleted ones on the old. */
const changedLines = (hunk: Hunk): PointLines | null => {
  const added = hunk.lines.flatMap((line) => (line.kind === "add" ? (line.newLine ?? []) : []));
  const deleted = hunk.lines.flatMap((line) => (line.kind === "del" ? (line.oldLine ?? []) : []));
  const [side, numbers] =
    added.length > 0 ? (["new", added] as const) : (["old", deleted] as const);
  const first = numbers[0];
  const last = numbers.at(-1);
  return first === undefined || last === undefined
    ? null
    : { hunkId: hunk.id, side, startLine: first, line: last };
};

export interface PointsInput {
  readonly files: readonly FileChange[];
  readonly intent: Intent | null;
  readonly findings: readonly Finding[];
  /** What the model run was given; without it no point keeps a guidance mark. */
  readonly guidance?: Guidance | null;
}

const RANK: Readonly<Record<Severity, number>> = { blocking: 0, major: 1, minor: 2 };

/**
 * The model's points on an analysis, in order: the findings by severity, blocking first, then the
 * intent's mismatches no finding names, each in the model's own order.
 */
export const pointsOf = (analysis: PointsInput): Point[] => {
  const hunks = new Map(
    analysis.files.flatMap((file) => file.hunks.map((hunk) => [hunk.id, hunk] as const)),
  );
  const landing = (hunkIds: readonly HunkId[]) => {
    const known = hunkIds.filter((id) => hunks.has(id));
    const first = known[0];
    const hunk = first === undefined ? undefined : hunks.get(first);
    const lines = hunk === undefined ? null : changedLines(hunk);
    return { hunkIds: known, lines, path: lines === null ? null : (hunk?.path ?? null) };
  };

  const marked = (mark: GuidanceMark | null) => {
    const guidance = resolveGuidanceMark(mark, analysis.guidance ?? null);
    return guidance === null ? {} : { guidance };
  };

  const mismatchList = analysis.intent?.mismatches ?? [];
  const mismatchOf = (id: MismatchId | null) => {
    const at = id === null ? Number.NaN : Number(id.slice(1)) - 1;
    const found = mismatchList[at];
    return found === undefined ? null : { kind: found.kind, description: found.description };
  };
  const named = new Set<string>();
  const ranked = [...analysis.findings].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  const findings = ranked.flatMap((finding): Point[] => {
    const hunk = hunks.get(finding.lines.hunkId);
    if (hunk === undefined) return [];
    const mismatch = mismatchOf(finding.mismatch);
    if (mismatch !== null && finding.mismatch !== null) named.add(finding.mismatch);
    return [
      {
        id: PointId.parse(finding.id),
        title: finding.title,
        explanation: finding.explanation,
        path: hunk.path,
        lines: finding.lines,
        hunkIds: [hunk.id],
        type: finding.type,
        severity: finding.severity,
        suggestion: finding.lines.side === "new" ? finding.suggestion : null,
        mismatch,
        ...marked(finding.guidance),
        ...(finding.guardrail === undefined ? {} : { guardrail: finding.guardrail }),
      },
    ];
  });

  // A mismatch a finding shows is a line of that finding, not a point of its own.
  const mismatches = mismatchList.flatMap((mismatch, index): Point[] => {
    const id = `m${index + 1}`;
    if (named.has(id)) return [];
    return [
      {
        id: PointId.parse(id),
        title: mismatch.description,
        explanation: MISMATCH_EXPLANATION[mismatch.kind],
        ...landing(mismatch.hunkIds),
        type: null,
        severity: null,
        suggestion: null,
        mismatch: null,
      },
    ];
  });

  return [...findings, ...mismatches];
};

/** What can be wrong with a finding the model wrote. */
export type FindingProblem =
  | { readonly kind: "unknown-hunk"; readonly index: number; readonly hunkId: HunkId }
  | { readonly kind: "lines-outside"; readonly index: number; readonly hunkId: HunkId }
  | { readonly kind: "blank"; readonly index: number; readonly field: "title" }
  /** A suggestion on base-side lines, which a comment can't replace. */
  | { readonly kind: "suggestion-old-side"; readonly index: number }
  | { readonly kind: "unknown-mismatch"; readonly index: number; readonly mismatch: MismatchId };

/** Problems that cost a finding only its suggestion or mismatch, not its place. */
export const strippable = (problem: FindingProblem): boolean =>
  problem.kind === "suggestion-old-side" || problem.kind === "unknown-mismatch";

/**
 * Whether a draft finding names a hunk of the PR and lines that hunk shows, with a title, a
 * suggestion only for head-side lines and a mismatch the intent has. Text over the prompt's limits
 * isn't a problem: a retry for it cost a whole findings pass, about two minutes, for words the
 * card shows in full anyway.
 */
export const validateFindings = (
  findings: readonly Omit<Finding, "id" | "guardrail">[],
  hunks: ReadonlyMap<HunkId, Hunk>,
  mismatches = 0,
): FindingProblem[] =>
  findings.flatMap((finding, index): FindingProblem[] => {
    const problems: FindingProblem[] = [];
    if (finding.title.trim() === "") problems.push({ kind: "blank", index, field: "title" });
    const { hunkId, side, startLine, line } = finding.lines;
    const hunk = hunks.get(hunkId);
    if (hunk === undefined) problems.push({ kind: "unknown-hunk", index, hunkId });
    else if (!hunkHasLine(hunk, side, startLine) || !hunkHasLine(hunk, side, line)) {
      problems.push({ kind: "lines-outside", index, hunkId });
    }
    if (finding.suggestion !== null && side === "old") {
      problems.push({ kind: "suggestion-old-side", index });
    }
    const mismatch = finding.mismatch;
    if (mismatch !== null && Number(mismatch.slice(1)) > mismatches) {
      problems.push({ kind: "unknown-mismatch", index, mismatch });
    }
    return problems;
  });
