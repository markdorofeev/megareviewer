import { z } from "zod";
import { type FileChange, type Hunk, HunkId, hunkHasLine } from "../diff/index.ts";
import type { Decision } from "./decision.ts";
import { type Intent, IntentMismatchKind } from "./intent.ts";
import { PointLines } from "./point-lines.ts";
import { Timestamp } from "./primitives.ts";
import type { RiskAssessment } from "./risk.ts";

export { PointLines };

export const MAX_FINDING_TITLE = 80;
export const MAX_FINDING_EXPLANATION = 300;

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

/** Something in the code that looks wrong, on the lines it rests on: a draft comment. */
export const Finding = z
  .object({
    id: FindingId,
    title: z.string().min(1),
    explanation: z.string(),
    lines: PointLines,
    severity: Severity.default("major"),
    /** The new-side lines that replace the ones it rests on; null when it suggests none. */
    suggestion: z.array(z.string()).readonly().nullable().default(null),
    /** The intent mismatch it shows, which then isn't a point of its own. */
    mismatch: MismatchId.nullable().default(null),
  })
  .readonly();
export type Finding = z.infer<typeof Finding>;

export const PointKind = z.enum(["finding", "risk", "decision"]);
export type PointKind = z.infer<typeof PointKind>;

/**
 * A finding's ID, "m1" for the first intent mismatch, a decision's ID, or "r:" and the hunk ID for
 * the model's risk on a hunk.
 */
export const PointId = z
  .string()
  .regex(/^([fmd][1-9][0-9]*|r:h_[0-9a-f]{16}(-[2-9]|-[1-9][0-9]+)?)$/)
  .brand<"PointId">();
export type PointId = z.infer<typeof PointId>;

/** What the model asks the reviewer to look at: a finding, a risk or a decision. */
export const Point = z
  .object({
    id: PointId,
    kind: PointKind,
    title: z.string().min(1),
    explanation: z.string(),
    /** The file of `lines`; null with them. */
    path: z.string().nullable(),
    /** Where the point lands in the code; null for a mismatch the model tied to no hunk. */
    lines: PointLines.nullable(),
    /** Every hunk the point rests on, `lines`' first. */
    hunkIds: z.array(HunkId).readonly(),
    /** A finding's severity; null for a mismatch no finding named, and the other kinds. */
    severity: Severity.nullable(),
    /** A finding's suggested lines, in place of `lines`. */
    suggestion: z.array(z.string()).readonly().nullable(),
    /** The intent mismatch a finding shows. */
    mismatch: z.object({ kind: IntentMismatchKind, description: z.string() }).readonly().nullable(),
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
  readonly risk: readonly RiskAssessment[];
  readonly decisions: readonly Decision[];
}

/**
 * The model's points on an analysis, in order: findings, the intent's mismatches as findings,
 * risks, then decisions, each in the model's own order. A risk is a hunk the model marked
 * contract: the path rules' contract alone is never shown, since a rule reads the path, not the code.
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

  const mismatchList = analysis.intent?.mismatches ?? [];
  const mismatchOf = (id: MismatchId | null) => {
    const at = id === null ? Number.NaN : Number(id.slice(1)) - 1;
    const found = mismatchList[at];
    return found === undefined ? null : { kind: found.kind, description: found.description };
  };
  const named = new Set<string>();
  const findings = analysis.findings.flatMap((finding): Point[] => {
    const hunk = hunks.get(finding.lines.hunkId);
    if (hunk === undefined) return [];
    const mismatch = mismatchOf(finding.mismatch);
    if (mismatch !== null && finding.mismatch !== null) named.add(finding.mismatch);
    return [
      {
        id: PointId.parse(finding.id),
        kind: "finding",
        title: finding.title,
        explanation: finding.explanation,
        path: hunk.path,
        lines: finding.lines,
        hunkIds: [hunk.id],
        severity: finding.severity,
        suggestion: finding.lines.side === "new" ? finding.suggestion : null,
        mismatch,
      },
    ];
  });

  const NONE = { severity: null, suggestion: null, mismatch: null } as const;
  // A mismatch a finding shows is a line of that finding, not a point of its own.
  const mismatches = mismatchList.flatMap((mismatch, index): Point[] => {
    const id = `m${index + 1}`;
    if (named.has(id)) return [];
    return [
      {
        id: PointId.parse(id),
        kind: "finding",
        title: mismatch.description,
        explanation: MISMATCH_EXPLANATION[mismatch.kind],
        ...landing(mismatch.hunkIds),
        ...NONE,
      },
    ];
  });

  const risks = analysis.risk.flatMap((risk): Point[] => {
    if (risk.source !== "model" || risk.riskClass !== "contract") return [];
    const landed = landing([risk.hunkId]);
    if (landed.lines === null) return [];
    return [
      {
        id: PointId.parse(`r:${risk.hunkId}`),
        kind: "risk",
        title: risk.reason,
        explanation: "",
        ...landed,
        ...NONE,
      },
    ];
  });

  const decisions = analysis.decisions.map((decision): Point => {
    const landed = landing(decision.hunkIds);
    const own = decision.lines;
    const hunk = own === null ? undefined : hunks.get(own.hunkId);
    // Its own line when one of its hunks shows it, else its first hunk's changed lines.
    const fits =
      own !== null && hunk !== undefined && decisionLinesFit(decision.hunkIds, own, hunks);
    return {
      id: PointId.parse(decision.id),
      kind: "decision",
      title: decision.title,
      explanation: decision.whyItMatters,
      ...landed,
      ...(fits
        ? {
            lines: own,
            path: hunk.path,
            hunkIds: [own.hunkId, ...landed.hunkIds.filter((id) => id !== own.hunkId)],
          }
        : {}),
      ...NONE,
    };
  });

  return [...findings, ...mismatches, ...risks, ...decisions];
};

/** Whether a decision's own lines are in one of its hunks, which shows them. */
export const decisionLinesFit = (
  hunkIds: readonly HunkId[],
  lines: PointLines,
  hunks: ReadonlyMap<HunkId, Hunk>,
): boolean => {
  const hunk = hunks.get(lines.hunkId);
  return (
    hunk !== undefined &&
    hunkIds.includes(lines.hunkId) &&
    hunkHasLine(hunk, lines.side, lines.startLine) &&
    hunkHasLine(hunk, lines.side, lines.line)
  );
};

/** What can be wrong with a finding the model wrote. */
export type FindingProblem =
  | { readonly kind: "unknown-hunk"; readonly index: number; readonly hunkId: HunkId }
  | { readonly kind: "lines-outside"; readonly index: number; readonly hunkId: HunkId }
  | {
      readonly kind: "blank" | "too-long";
      readonly index: number;
      readonly field: "title" | "explanation";
    }
  /** A suggestion on base-side lines, which a comment can't replace. */
  | { readonly kind: "suggestion-old-side"; readonly index: number }
  | { readonly kind: "unknown-mismatch"; readonly index: number; readonly mismatch: MismatchId };

/** Problems that cost a finding only its suggestion or mismatch, not its place. */
export const strippable = (problem: FindingProblem): boolean =>
  problem.kind === "suggestion-old-side" || problem.kind === "unknown-mismatch";

/**
 * Whether a draft finding names a hunk of the PR and lines that hunk shows, with text that fits, a
 * suggestion only for head-side lines and a mismatch the intent has.
 */
export const validateFindings = (
  findings: readonly Omit<Finding, "id">[],
  hunks: ReadonlyMap<HunkId, Hunk>,
  mismatches = 0,
): FindingProblem[] =>
  findings.flatMap((finding, index): FindingProblem[] => {
    const problems: FindingProblem[] = [];
    if (finding.title.trim() === "") problems.push({ kind: "blank", index, field: "title" });
    if (finding.title.length > MAX_FINDING_TITLE) {
      problems.push({ kind: "too-long", index, field: "title" });
    }
    if (finding.explanation.length > MAX_FINDING_EXPLANATION) {
      problems.push({ kind: "too-long", index, field: "explanation" });
    }
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
