import { z } from "zod";
import {
  type FileChange,
  type Hunk,
  HunkId,
  hunkHasLine,
  type MechanicalProof,
} from "../diff/index.ts";
import type { Decision } from "./decision.ts";
import type { Intent, IntentMismatchKind } from "./intent.ts";
import { Timestamp } from "./primitives.ts";
import type { RiskAssessment } from "./risk.ts";
import { classifyByRules } from "./risk-rules.ts";

export const MAX_FINDING_TITLE = 80;
export const MAX_FINDING_EXPLANATION = 300;

/** "f1", "f2", … in the order the model listed the findings. */
export const FindingId = z
  .string()
  .regex(/^f[1-9][0-9]*$/)
  .brand<"FindingId">();
export type FindingId = z.infer<typeof FindingId>;

/** Lines of one hunk, `startLine` to `line`: new is the head side, old the base. */
export const PointLines = z
  .object({
    hunkId: HunkId,
    side: z.enum(["new", "old"]),
    startLine: z.number().int().positive(),
    line: z.number().int().positive(),
  })
  .readonly()
  .refine((lines) => lines.startLine <= lines.line, {
    message: "startLine must not come after line",
  });
export type PointLines = z.infer<typeof PointLines>;

/** Something in the code that looks wrong, on the lines it rests on. */
export const Finding = z
  .object({
    id: FindingId,
    title: z.string().min(1),
    explanation: z.string(),
    lines: PointLines,
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
  readonly proofs: readonly MechanicalProof[];
  readonly intent: Intent | null;
  readonly findings: readonly Finding[];
  readonly risk: readonly RiskAssessment[];
  readonly decisions: readonly Decision[];
}

/**
 * The model's points on an analysis, in order: findings, the intent's mismatches as findings,
 * risks, then decisions, each in the model's own order. A risk is a point only when the model
 * raised it: a hunk the path rules mark contract is counted on its file instead.
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

  const findings = analysis.findings.flatMap((finding): Point[] => {
    const hunk = hunks.get(finding.lines.hunkId);
    if (hunk === undefined) return [];
    return [
      {
        id: PointId.parse(finding.id),
        kind: "finding",
        title: finding.title,
        explanation: finding.explanation,
        path: hunk.path,
        lines: finding.lines,
        hunkIds: [hunk.id],
      },
    ];
  });

  const mismatches = (analysis.intent?.mismatches ?? []).map(
    (mismatch, index): Point => ({
      id: PointId.parse(`m${index + 1}`),
      kind: "finding",
      title: mismatch.description,
      explanation: MISMATCH_EXPLANATION[mismatch.kind],
      ...landing(mismatch.hunkIds),
    }),
  );

  const proved = new Set(analysis.proofs.flatMap((proof) => proof.hunkId ?? []));
  const ruleContract = new Set(
    classifyByRules(analysis.files, proved)
      .filter((rule) => rule.riskClass === "contract")
      .map((rule) => rule.hunkId),
  );
  const risks = analysis.risk.flatMap((risk): Point[] => {
    if (risk.source !== "model" || risk.riskClass !== "contract") return [];
    if (ruleContract.has(risk.hunkId)) return [];
    const landed = landing([risk.hunkId]);
    if (landed.lines === null) return [];
    return [
      {
        id: PointId.parse(`r:${risk.hunkId}`),
        kind: "risk",
        title: risk.reason,
        explanation: "",
        ...landed,
      },
    ];
  });

  const decisions = analysis.decisions.map(
    (decision): Point => ({
      id: PointId.parse(decision.id),
      kind: "decision",
      title: decision.title,
      explanation: decision.whyItMatters,
      ...landing(decision.hunkIds),
    }),
  );

  return [...findings, ...mismatches, ...risks, ...decisions];
};

/** What can be wrong with a finding the model wrote. */
export type FindingProblem =
  | { readonly kind: "unknown-hunk"; readonly index: number; readonly hunkId: HunkId }
  | { readonly kind: "lines-outside"; readonly index: number; readonly hunkId: HunkId }
  | {
      readonly kind: "blank" | "too-long";
      readonly index: number;
      readonly field: "title" | "explanation";
    };

/** Whether a draft finding names a hunk of the PR and lines that hunk shows, with text that fits. */
export const validateFindings = (
  findings: readonly Omit<Finding, "id">[],
  hunks: ReadonlyMap<HunkId, Hunk>,
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
    return problems;
  });
