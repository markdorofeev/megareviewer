import type { CallGraphHint, FileChange, HunkId } from "../../domain/diff/index.ts";
import {
  type CoverageProblem,
  codeTour,
  type Decision,
  DecisionId,
  type Intent,
  type ModelError,
  type ModelPass,
  type ModelUsage,
  type RiskAssessment,
  type Tour,
  TourStepId,
  validateHunkReferences,
  validateRiskCoverage,
  validateTour,
} from "../../domain/review/index.ts";
import { ok, type Result } from "../../domain/shared/index.ts";
import type {
  AnalysisInput,
  AnalysisModel,
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
  readonly warnings: readonly string[];
}

type PassCall<T> = (options?: PassOptions) => Promise<Result<PassOutput<T>, ModelError>>;

/**
 * Calls a pass, and once more with feedback when its answer is invalid: unparseable, or with
 * the problems `check` finds. The answer comes back with whatever problems are left, for the
 * caller to repair; when the retry fails outright, the first answer is repaired instead.
 */
const callChecked = async <T>(
  pass: ModelPass,
  call: PassCall<T>,
  check: (value: T) => string[],
  logger: Logger,
): Promise<{
  outcome: Result<{ value: T; problems: string[] }, ModelError>;
  usage: ModelUsage[];
}> => {
  const usage: ModelUsage[] = [];
  const checked = (output: PassOutput<T>) => {
    usage.push(output.usage);
    return { value: output.value, problems: check(output.value) };
  };
  const first = await call();
  if (!first.ok && first.error.kind !== "invalid-output") return { outcome: first, usage };
  const firstChecked = first.ok ? checked(first.value) : null;
  if (firstChecked?.problems.length === 0) return { outcome: ok(firstChecked), usage };
  const feedback = first.ok ? (firstChecked?.problems ?? []) : [first.error.message];

  logger.info("Retrying a model pass with feedback", { pass, problems: feedback.length });
  const second = await call({ feedback });
  if (second.ok) return { outcome: ok(checked(second.value)), usage };
  if (firstChecked === null) return { outcome: second, usage };
  logger.warn("A model pass retry failed; repairing the first answer", {
    pass,
    error: second.error.message,
  });
  return { outcome: ok(firstChecked), usage };
};

type Feedback = Readonly<Record<CoverageProblem["kind"], (hunkId: HunkId) => string>>;

const RISK_FEEDBACK: Feedback = {
  missing: (id) => `${id} has no risk class. Classify every hunk sent in full exactly once.`,
  duplicate: (id) => `${id} is classified more than once.`,
  unknown: (id) => `${id} isn't a hunk sent in full, so don't classify it.`,
};

const TOUR_FEEDBACK: Feedback = {
  missing: (id) => `${id} is in no step. Put every hunk sent in full in exactly one step.`,
  duplicate: (id) => `${id} is in more than one step.`,
  unknown: (id) => `${id} isn't a hunk sent in full, so leave it out of the tour.`,
};

const describeProblem = (feedback: Feedback) => (problem: CoverageProblem) =>
  feedback[problem.kind](problem.hunkId);

const describeUnknown = (hunkId: HunkId): string => `${hunkId} isn't a hunk of this pull request.`;

export const runIntent = async (
  model: AnalysisModel,
  input: AnalysisInput,
  knownHunks: ReadonlySet<HunkId>,
  logger: Logger,
): Promise<PassResult<Intent>> => {
  const unknownIn = (intent: Intent) =>
    validateHunkReferences(
      knownHunks,
      intent.mismatches.flatMap((mismatch) => mismatch.hunkIds),
    );
  const { outcome, usage } = await callChecked(
    "intent",
    (options) => model.intent(input, options),
    (intent) => unknownIn(intent).map(describeUnknown),
    logger,
  );
  if (!outcome.ok) return { outcome, usage, warnings: [] };
  const { value: intent, problems } = outcome.value;
  if (problems.length === 0) return { outcome: ok(intent), usage, warnings: [] };
  const unknown = unknownIn(intent).length;
  const repaired: Intent = {
    ...intent,
    mismatches: intent.mismatches.map((mismatch) => ({
      ...mismatch,
      hunkIds: mismatch.hunkIds.filter((id) => knownHunks.has(id)),
    })),
  };
  return {
    outcome: ok(repaired),
    usage,
    warnings: [`Dropped ${count(unknown, "unknown hunk reference")} from intent mismatches`],
  };
};

export interface RiskOutcome {
  /** The model's assessments, one per required hunk, with fallbacks for the ones it missed. */
  readonly assessments: readonly RiskAssessment[];
  /** The same, as the tour pass takes them. */
  readonly forTour: readonly ModelRisk[];
}

export const runRisk = async (
  model: AnalysisModel,
  input: AnalysisInput,
  intent: Intent,
  required: ReadonlySet<HunkId>,
  logger: Logger,
): Promise<PassResult<RiskOutcome>> => {
  const { outcome, usage } = await callChecked(
    "risk",
    (options) => model.risk(input, intent, options),
    (risk) => validateRiskCoverage(risk, required).map(describeProblem(RISK_FEEDBACK)),
    logger,
  );
  if (!outcome.ok) return { outcome, usage, warnings: [] };

  // Keep the first assessment per required hunk; drop the rest.
  const kept = new Map<HunkId, ModelRisk>();
  for (const risk of outcome.value.value) {
    if (required.has(risk.hunkId) && !kept.has(risk.hunkId)) kept.set(risk.hunkId, risk);
  }
  const missing = [...required].filter((hunkId) => !kept.has(hunkId));
  // Unclassified hunks show as ordinary logic: visible, never collapsed.
  const fallbacks = missing.map((hunkId) => ({
    hunkId,
    riskClass: "logic" as const,
    reason: "Not classified by the model",
  }));
  const warnings =
    outcome.value.problems.length === 0
      ? []
      : missing.length > 0
        ? [`The model didn't classify ${count(missing.length, "hunk")}, so they're shown as logic`]
        : ["Ignored risk classifications for unknown or repeated hunks"];
  return {
    outcome: ok({
      assessments: [
        ...[...kept.values()].map((risk) => ({ ...risk, source: "model" as const })),
        ...fallbacks.map((risk) => ({ ...risk, source: "fallback" as const })),
      ],
      forTour: [...kept.values(), ...fallbacks],
    }),
    usage,
    warnings,
  };
};

export const runDecisions = async (
  model: AnalysisModel,
  input: AnalysisInput,
  intent: Intent,
  knownHunks: ReadonlySet<HunkId>,
  logger: Logger,
): Promise<PassResult<Decision[]>> => {
  const unknownIn = (drafts: readonly { readonly hunkIds: readonly HunkId[] }[]) =>
    validateHunkReferences(
      knownHunks,
      drafts.flatMap((draft) => draft.hunkIds),
    );
  const { outcome, usage } = await callChecked(
    "decisions",
    (options) => model.decisions(input, intent, options),
    (drafts) => unknownIn(drafts).map(describeUnknown),
    logger,
  );
  if (!outcome.ok) return { outcome, usage, warnings: [] };
  const { value: drafts, problems } = outcome.value;
  const unknown = unknownIn(drafts).length;
  return {
    outcome: ok(
      drafts.map((draft, index) => ({
        ...draft,
        id: DecisionId.parse(`d${index + 1}`),
        hunkIds: draft.hunkIds.filter((id) => knownHunks.has(id)),
      })),
    ),
    usage,
    warnings:
      problems.length === 0
        ? []
        : [`Dropped ${count(unknown, "unknown hunk reference")} from decisions`],
  };
};

/** Never fails: a tour the model can't build is replaced by the one from the call graph. */
export const runTour = async (
  model: AnalysisModel,
  input: AnalysisInput,
  context: {
    readonly intent: Intent;
    readonly risk: readonly ModelRisk[];
    readonly decisions: readonly Decision[];
    readonly files: readonly FileChange[];
    readonly required: ReadonlySet<HunkId>;
    readonly callGraph: readonly CallGraphHint[];
    readonly definitions: ReadonlyMap<HunkId, readonly string[]>;
    /** Every hunk's final risk, for the call-graph tour's order. */
    readonly assessments: readonly RiskAssessment[];
  },
  logger: Logger,
): Promise<{ tour: Tour; usage: readonly ModelUsage[]; warnings: readonly string[] }> => {
  const { required } = context;
  const { outcome, usage } = await callChecked(
    "tour",
    (options) => model.tour(input, context.intent, context.risk, context.decisions, options),
    (tour) => validateTour(tour, required).map(describeProblem(TOUR_FEEDBACK)),
    logger,
  );
  const fallback = (reason: string) => ({
    tour: codeTour({
      files: context.files,
      required,
      callGraph: context.callGraph,
      risk: context.assessments,
      definitions: context.definitions,
    }),
    usage,
    warnings: [`${reason}, so the tour follows the call graph instead`],
  });
  if (!outcome.ok) {
    return fallback(`The guided tour couldn't be built (${outcome.error.message})`);
  }
  if (outcome.value.problems.length > 0) {
    return fallback("The guided tour didn't cover every hunk exactly once");
  }
  return {
    tour: {
      steps: outcome.value.value.steps.map((step, index) => ({
        ...step,
        id: TourStepId.parse(`s${index + 1}`),
        kind: "flow" as const,
        via: [],
      })),
      builtBy: "model",
    },
    usage,
    warnings: [],
  };
};
