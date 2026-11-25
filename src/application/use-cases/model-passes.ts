import type { Hunk, HunkId } from "../../domain/diff/index.ts";
import {
  checkGuidanceMark,
  type Finding,
  FindingId,
  type FindingProblem,
  type Guidance,
  type GuidanceMark,
  type Intent,
  keptSteps,
  MIN_STEPS,
  type ModelCall,
  type ModelError,
  type ModelPass,
  type ModelUsage,
  type Step,
  type StepContext,
  type StepProblem,
  strippable,
  validateFindings,
  validateHunkReferences,
  validateSteps,
} from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import type {
  AnalysisInput,
  AnalysisModel,
  Clock,
  Logger,
  PassOptions,
  PassOutput,
} from "../ports/index.ts";

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

/**
 * A finding's guidance mark when it checks out against what the run was given, else
 * null: the point stays, unmarked, so the reviewer sees it as any other. Logged, never retried.
 */
const checkedMark = (
  mark: GuidanceMark | null,
  guidance: Guidance | null,
  logger: Logger,
  on: Readonly<Record<string, unknown>>,
): GuidanceMark | null => {
  const checked = checkGuidanceMark(mark, guidance);
  if (mark !== null && checked === null) {
    logger.warn("Dropped a guidance mark that doesn't check out", { ...on, ...mark });
  }
  return checked;
};

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
 * not shown: the reviewer can't act on the model's mistake. One wrong only in its suggestion,
 * mismatch or guidance mark keeps its place without them.
 */
export const runFindings = async (
  model: AnalysisModel,
  input: AnalysisInput,
  intent: Intent | null,
  hunks: ReadonlyMap<HunkId, Hunk>,
  deps: PassDeps,
  guidance: Guidance | null = null,
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
            guidance: checkedMark(draft.guidance, guidance, deps.logger, { finding: index + 1 }),
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

/**
 * The model with every pass told that the run asked for the tour, so they all send the answer
 * schema with the steps pass's variant and share one cache.
 */
export const askingForTour = (model: AnalysisModel): AnalysisModel => ({
  version: model.version,
  checkSize: (input) => model.checkSize(input),
  intent: (input, options) => model.intent(input, { ...options, tour: true }),
  findings: (input, intent, options) => model.findings(input, intent, { ...options, tour: true }),
  steps: (input, options) => model.steps(input, { ...options, tour: true }),
});

const describeStepProblem = (problem: StepProblem): string => {
  const step = `Step ${problem.step + 1}`;
  switch (problem.kind) {
    case "unknown-hunk":
      return `${step}'s excerpt ${problem.excerpt + 1} rests on ${problem.hunkId}, which isn't a hunk of this pull request.`;
    case "mechanical":
      return `${step}'s excerpt ${problem.excerpt + 1} rests on ${problem.hunkId}, a mechanical hunk sent as stats only. Use hunks sent in full.`;
    case "lines-outside":
      return `${step}'s excerpt ${problem.excerpt + 1} has lines ${problem.hunkId} doesn't show on that side.`;
    case "same-file":
      return `${step} has two excerpts in one file. Give two only when the hop crosses into another process, each in its own file.`;
    case "order":
      return `${step} comes before step ${problem.caller + 1}, whose code calls it. Put callers first.`;
    case "too-many":
      return `${step} is past the seventh. Merge neighboring steps into at most 7.`;
  }
};

/**
 * The page's tour: the steps the model wrote, checked, with one retry for what the checks find.
 * After it, what's still wrong is repaired as `keptSteps` says and logged. An answer of fewer than
 * three steps is no tour: the change is too small for one. An answer the checks leave with fewer
 * than three is no tour either, and the reason is the pass's error, which the page shows.
 */
export const runSteps = async (
  model: AnalysisModel,
  input: AnalysisInput,
  context: StepContext,
  deps: PassDeps,
): Promise<PassResult<Step[]>> => {
  const { outcome, usage, modelCalls } = await callChecked(
    "steps",
    (options) => model.steps(input, options),
    (drafts) => validateSteps(drafts, context).map(describeStepProblem),
    deps,
  );
  if (!outcome.ok) return { outcome, usage, modelCalls, warnings: [] };
  const drafts = outcome.value.value;
  if (drafts.length < MIN_STEPS) return { outcome: ok([]), usage, modelCalls, warnings: [] };
  const problems = validateSteps(drafts, context);
  if (problems.length > 0) {
    deps.logger.warn("Repaired the steps the checks found wrong after the retry", {
      problems: problems.map(describeStepProblem),
    });
  }
  const steps = keptSteps(drafts, problems);
  if (steps.length < MIN_STEPS) {
    return {
      outcome: err({
        kind: "invalid-output",
        message: `Only ${steps.length} of the tour's ${drafts.length} steps showed lines of this pull request, and a tour needs ${MIN_STEPS}`,
      }),
      usage,
      modelCalls,
      warnings: [],
    };
  }
  return { outcome: ok(steps), usage, modelCalls, warnings: [] };
};
