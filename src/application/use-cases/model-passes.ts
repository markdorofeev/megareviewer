import type { Hunk, HunkId, PartId } from "../../domain/diff/index.ts";
import {
  type CoverageProblem,
  type Decision,
  DecisionId,
  type Finding,
  FindingId,
  type FindingProblem,
  type Intent,
  type ModelCall,
  type ModelError,
  type ModelPass,
  type ModelUsage,
  pointLinesFit,
  type RiskAssessment,
  strippable,
  validateFindings,
  validateHunkReferences,
  validateRiskCoverage,
} from "../../domain/review/index.ts";
import { ok, type Result } from "../../domain/shared/index.ts";
import type {
  AnalysisInput,
  AnalysisModel,
  Clock,
  Logger,
  ModelRisk,
  PassOptions,
  PassOutput,
} from "../ports/index.ts";
import { count } from "./text.ts";

export interface PassResult<T> {
  readonly outcome: Result<T, ModelError>;
  /** Every successful call, retries included. */
  readonly usage: readonly ModelUsage[];
  /** Every call, failed ones included. */
  readonly modelCalls: readonly ModelCall[];
  readonly warnings: readonly string[];
}

type PassCall<T> = (options?: PassOptions) => Promise<Result<PassOutput<T>, ModelError>>;

export interface PassDeps {
  readonly logger: Logger;
  readonly clock: Clock;
}

/**
 * Calls a pass, and once more with feedback when its answer is invalid: unparseable, or with
 * the problems `check` finds. The answer comes back with whatever problems are left, for the
 * caller to repair; when the retry fails outright, the first answer is repaired instead. Every
 * call is traced, with when it ran and what came of it.
 */
const callChecked = async <T>(
  pass: ModelPass,
  call: PassCall<T>,
  check: (value: T) => string[],
  { logger, clock }: PassDeps,
): Promise<{
  outcome: Result<{ value: T; problems: string[] }, ModelError>;
  usage: ModelUsage[];
  modelCalls: ModelCall[];
}> => {
  const usage: ModelUsage[] = [];
  const modelCalls: ModelCall[] = [];
  const attempt = async (
    number: number,
    options?: PassOptions,
  ): Promise<Result<{ value: T; problems: string[] }, ModelError>> => {
    const startedAt = clock.now();
    const result = await call(options);
    const durationMs = Math.max(0, Date.parse(clock.now()) - Date.parse(startedAt));
    const problems = result.ok ? check(result.value.value) : [];
    if (result.ok) usage.push({ ...result.value.usage, startedAt, durationMs });
    modelCalls.push({
      pass,
      attempt: number,
      startedAt,
      durationMs,
      outcome: !result.ok ? "failed" : problems.length > 0 ? "problems" : "ok",
      problems,
      error: result.ok ? null : result.error,
    });
    if (!result.ok) {
      logger.warn("Model call failed", {
        pass,
        attempt: number,
        durationMs,
        kind: result.error.kind,
        message: result.error.message,
      });
      return result;
    }
    logger.info("Model call answered", { pass, attempt: number, durationMs, problems });
    return ok({ value: result.value.value, problems });
  };

  const first = await attempt(1);
  if (!first.ok && first.error.kind !== "invalid-output")
    return { outcome: first, usage, modelCalls };
  if (first.ok && first.value.problems.length === 0) return { outcome: first, usage, modelCalls };
  const feedback = first.ok ? first.value.problems : [first.error.message];

  logger.info("Retrying a model pass with feedback", { pass, problems: feedback.length });
  const second = await attempt(2, { feedback });
  if (second.ok || !first.ok) return { outcome: second, usage, modelCalls };
  logger.warn("A model pass retry failed; repairing the first answer", {
    pass,
    error: second.error.message,
  });
  return { outcome: first, usage, modelCalls };
};

type Feedback = Readonly<Record<CoverageProblem["kind"], (id: PartId) => string>>;

const RISK_FEEDBACK: Feedback = {
  missing: (id) => `${id} has no risk class. Classify every hunk sent in full exactly once.`,
  duplicate: (id) => `${id} is classified more than once.`,
  unknown: (id) => `${id} isn't a hunk sent in full, so don't classify it.`,
};

const describeProblem = (feedback: Feedback) => (problem: CoverageProblem) =>
  feedback[problem.kind](problem.id);

const describeUnknown = (hunkId: HunkId): string => `${hunkId} isn't a hunk of this pull request.`;

export const runIntent = async (
  model: AnalysisModel,
  input: AnalysisInput,
  knownHunks: ReadonlySet<HunkId>,
  deps: PassDeps,
  onAnswering?: () => void,
): Promise<PassResult<Intent>> => {
  const unknownIn = (intent: Intent) =>
    validateHunkReferences(
      knownHunks,
      intent.mismatches.flatMap((mismatch) => mismatch.hunkIds),
    );
  const { outcome, usage, modelCalls } = await callChecked(
    "intent",
    (options) =>
      model.intent(input, onAnswering === undefined ? options : { ...options, onAnswering }),
    (intent) => unknownIn(intent).map(describeUnknown),
    deps,
  );
  if (!outcome.ok) return { outcome, usage, modelCalls, warnings: [] };
  const { value: intent, problems } = outcome.value;
  if (problems.length === 0) return { outcome: ok(intent), usage, modelCalls, warnings: [] };
  // Not a warning on the page: the reviewer can't act on the model's mistake.
  deps.logger.warn("Dropped unknown hunk references from intent mismatches", {
    count: unknownIn(intent).length,
  });
  const repaired: Intent = {
    ...intent,
    mismatches: intent.mismatches.map((mismatch) => ({
      ...mismatch,
      hunkIds: mismatch.hunkIds.filter((id) => knownHunks.has(id)),
    })),
  };
  return { outcome: ok(repaired), usage, modelCalls, warnings: [] };
};

const FINDING_FEEDBACK = (problem: FindingProblem): string => {
  const finding = `Finding ${problem.index + 1}`;
  switch (problem.kind) {
    case "unknown-hunk":
      return `${finding} rests on ${problem.hunkId}, which isn't a hunk of this pull request.`;
    case "lines-outside":
      return `${finding}'s lines aren't lines ${problem.hunkId} shows on that side.`;
    case "blank":
      return `${finding} has a blank title.`;
    case "suggestion-old-side":
      return `${finding} suggests a change for "-" lines; a suggestion replaces only new-side lines, so give none or rest the finding on new-side lines.`;
    case "unknown-mismatch":
      return `${finding} names ${problem.mismatch}, which isn't one of the intent's mismatches.`;
  }
};

/**
 * Findings on lines the PR's hunks show, each with the intent's mismatch it shows, if any; the
 * intent is null when its pass failed. One still invalid after the retry is dropped and logged,
 * not shown: the reviewer can't act on the model's mistake. One wrong only in its suggestion or
 * mismatch keeps its place without them.
 */
export const runFindings = async (
  model: AnalysisModel,
  input: AnalysisInput,
  intent: Intent | null,
  hunks: ReadonlyMap<HunkId, Hunk>,
  deps: PassDeps,
): Promise<PassResult<Finding[]>> => {
  const mismatches = intent?.mismatches.length ?? 0;
  const { outcome, usage, modelCalls } = await callChecked(
    "findings",
    (options) => model.findings(input, intent, options),
    (drafts) => validateFindings(drafts, hunks, mismatches).map(FINDING_FEEDBACK),
    deps,
  );
  if (!outcome.ok) return { outcome, usage, modelCalls, warnings: [] };
  const drafts = outcome.value.value;
  const problems = validateFindings(drafts, hunks, mismatches);
  const invalid = new Set(problems.filter((one) => !strippable(one)).map((one) => one.index));
  if (invalid.size > 0) deps.logger.warn("Dropped invalid findings", { count: invalid.size });
  const stripped = (index: number, kind: FindingProblem["kind"]) =>
    problems.some((one) => one.index === index && one.kind === kind);
  const kept = drafts.flatMap((draft, index) =>
    invalid.has(index)
      ? []
      : [
          {
            ...draft,
            ...(stripped(index, "suggestion-old-side") ? { suggestion: null } : {}),
            ...(stripped(index, "unknown-mismatch") ? { mismatch: null } : {}),
          },
        ],
  );
  return {
    outcome: ok(kept.map((draft, index) => ({ ...draft, id: FindingId.parse(`f${index + 1}`) }))),
    usage,
    modelCalls,
    warnings: [],
  };
};

/** The model's assessments, one per required hunk, with fallbacks for the ones it missed. */
export const runRisk = async (
  model: AnalysisModel,
  input: AnalysisInput,
  required: ReadonlySet<HunkId>,
  hunks: ReadonlyMap<HunkId, Hunk>,
  deps: PassDeps,
): Promise<PassResult<RiskAssessment[]>> => {
  const { outcome, usage, modelCalls } = await callChecked(
    "risk",
    (options) => model.risk(input, options),
    (risk) => validateRiskCoverage(risk, required).map(describeProblem(RISK_FEEDBACK)),
    deps,
  );
  if (!outcome.ok) return { outcome, usage, modelCalls, warnings: [] };

  // Keep the first assessment per required hunk; drop the rest. Lines only a contract hunk
  // shows are kept; others fall back to its first changed lines, which isn't worth a retry.
  const kept = new Map<HunkId, ModelRisk>();
  for (const risk of outcome.value.value) {
    if (!required.has(risk.hunkId) || kept.has(risk.hunkId)) continue;
    const fits =
      risk.riskClass === "contract" &&
      risk.lines !== null &&
      pointLinesFit([risk.hunkId], risk.lines, hunks);
    kept.set(risk.hunkId, { ...risk, lines: fits ? risk.lines : null });
  }
  const missing = [...required].filter((hunkId) => !kept.has(hunkId));
  // Unclassified hunks show as ordinary logic: visible, never collapsed.
  const fallbacks = missing.map((hunkId) => ({
    hunkId,
    riskClass: "logic" as const,
    reason: "Not classified by the model",
    lines: null,
  }));
  const warnings =
    outcome.value.problems.length === 0
      ? []
      : missing.length > 0
        ? [`The model didn't classify ${count(missing.length, "hunk")}, so they're shown as logic`]
        : ["Ignored risk classifications for unknown or repeated hunks"];
  return {
    outcome: ok([
      ...[...kept.values()].map((risk) => ({ ...risk, source: "model" as const })),
      ...fallbacks.map((risk) => ({ ...risk, source: "fallback" as const })),
    ]),
    usage,
    modelCalls,
    warnings,
  };
};

export const runDecisions = async (
  model: AnalysisModel,
  input: AnalysisInput,
  hunks: ReadonlyMap<HunkId, Hunk>,
  deps: PassDeps,
): Promise<PassResult<Decision[]>> => {
  const knownHunks = new Set(hunks.keys());
  const unknownIn = (drafts: readonly { readonly hunkIds: readonly HunkId[] }[]) =>
    validateHunkReferences(
      knownHunks,
      drafts.flatMap((draft) => draft.hunkIds),
    );
  const { outcome, usage, modelCalls } = await callChecked(
    "decisions",
    (options) => model.decisions(input, options),
    (drafts) => unknownIn(drafts).map(describeUnknown),
    deps,
  );
  if (!outcome.ok) return { outcome, usage, modelCalls, warnings: [] };
  const { value: drafts, problems } = outcome.value;
  if (problems.length > 0) {
    // Not a warning on the page: the reviewer can't act on the model's mistake.
    deps.logger.warn("Dropped unknown hunk references from decisions", {
      count: unknownIn(drafts).length,
    });
  }
  return {
    outcome: ok(
      drafts.map((draft, index) => {
        const hunkIds = draft.hunkIds.filter((id) => knownHunks.has(id));
        // Lines outside its hunks fall back to its first hunk's: a footnote on the wrong line
        // isn't worth a retry.
        const lines =
          draft.lines !== null && pointLinesFit(hunkIds, draft.lines, hunks) ? draft.lines : null;
        return { ...draft, id: DecisionId.parse(`d${index + 1}`), hunkIds, lines };
      }),
    ),
    usage,
    modelCalls,
    warnings: [],
  };
};
