import type { Hunk, HunkId } from "../../domain/diff/index.ts";
import {
  checkGuidanceMark,
  type DataFlow,
  type DataFlowContext,
  type DataFlowProblem,
  type Finding,
  FindingId,
  type FindingProblem,
  type Guidance,
  type GuidanceMark,
  HARNESS_ROOT,
  type Intent,
  keptDataFlow,
  keptSteps,
  MIN_STEPS,
  type ModelCall,
  type ModelError,
  type ModelPass,
  type ModelUsage,
  type RefNames,
  refNames,
  type Step,
  type StepContext,
  type StepDraft,
  type StepProblem,
  strippable,
  validateDataFlow,
  validateFindings,
  validateHunkReferences,
  validateSteps,
  withoutRefs,
} from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import type {
  AnalysisInput,
  AnalysisModel,
  Clock,
  FindingDraft,
  Logger,
  PassError,
  PassOptions,
  PassOutput,
  TourDraft,
} from "../ports/index.ts";

export interface PassResult<T> {
  readonly outcome: Result<T, ModelError>;
  /** Every successful call, retries included. */
  readonly usage: readonly ModelUsage[];
  /** Every call, failed ones included. */
  readonly modelCalls: readonly ModelCall[];
  readonly warnings: readonly string[];
}

type PassCall<T> = (options?: PassOptions) => Promise<Result<PassOutput<T>, PassError>>;

export interface PassDeps {
  readonly logger: Logger;
  readonly clock: Clock;
}

/** An answer with each text of it the reviewer reads rewritten. */
type Rewrite<T> = (answer: T, text: (one: string) => string) => T;

interface Mended<T> {
  readonly value: T;
  /** What was mended, as the call's problems say it. */
  readonly notes: readonly string[];
}

/** The refs a run's prose can't have, by the guidance it was given and the pull request's own text. */
const proseRefs = (guidance: Guidance | null, { pullRequest, files }: AnalysisInput): RefNames =>
  refNames(guidance, [
    pullRequest.title,
    pullRequest.description,
    ...files.flatMap((file) => [
      file.headContent ?? "",
      ...file.hunks.flatMap((hunk) => hunk.lines.map((line) => line.text)),
    ]),
  ]);

/** Takes the run's refs out of what the reviewer reads, so a ref it can't look up never shows. */
const refsOutOf = <T>(
  guidance: Guidance | null,
  input: AnalysisInput,
  rewrite: Rewrite<T>,
): ((answer: T) => Mended<T>) => {
  const names = proseRefs(guidance, input);
  return (answer) => {
    const found = new Set<string>();
    const value = rewrite(answer, (one) => {
      const { text, refs } = withoutRefs(one, names);
      for (const ref of refs) found.add(ref);
      return text;
    });
    const notes = [...found].map((ref) => {
      const path = names.get(ref) ?? null;
      const mended = path === null ? "taken out" : `replaced with ${path}`;
      return `${ref} in text the reviewer reads: ${mended}`;
    });
    return { value, notes };
  };
};

/**
 * Calls a pass, and once more with feedback when its answer is invalid: unparseable, or with
 * the problems `check` finds. The answer comes back with whatever problems are left, for the
 * caller to repair; when the retry fails outright, the first answer is repaired instead. A call
 * whose read tool fails, or that uses up its rounds of reading, is made once more on the prompt
 * alone, and so is what follows it. Every call is traced, with when it ran, what it read and what
 * came of it: `mend` runs before the checks, and what it mended is among the call's problems without
 * a retry.
 */
const callChecked = async <T>(
  pass: ModelPass,
  call: PassCall<T>,
  mend: (value: T) => Mended<T>,
  check: (value: T) => string[],
  { logger, clock }: PassDeps,
): Promise<{
  outcome: Result<{ value: T; problems: string[] }, ModelError>;
  usage: ModelUsage[];
  modelCalls: ModelCall[];
}> => {
  const usage: ModelUsage[] = [];
  const modelCalls: ModelCall[] = [];
  const attemptOnce = async (
    options?: PassOptions,
  ): Promise<Result<{ value: T; problems: string[] }, ModelError>> => {
    const number = modelCalls.length + 1;
    const startedAt = clock.now();
    const called = await call(options);
    const durationMs = Math.max(0, Date.parse(clock.now()) - Date.parse(startedAt));
    const result = called.ok ? ok({ ...called.value, ...mend(called.value.value) }) : called;
    const problems = result.ok ? check(result.value.value) : [];
    const found = result.ok ? [...problems, ...result.value.notes] : [];
    if (result.ok) usage.push({ ...result.value.usage, startedAt, durationMs });
    const reads = (result.ok ? result.value.reads : result.error.reads) ?? [];
    modelCalls.push({
      pass,
      attempt: number,
      startedAt,
      durationMs,
      outcome: !result.ok ? "failed" : found.length > 0 ? "problems" : "ok",
      problems: found,
      error: result.ok ? null : { kind: result.error.kind, message: result.error.message },
      reads,
    });
    if (!result.ok) {
      logger.warn("Model call failed", {
        pass,
        attempt: number,
        durationMs,
        kind: result.error.kind,
        message: result.error.message,
        reads: reads.length,
      });
      return result;
    }
    logger.info("Model call answered", {
      pass,
      attempt: number,
      durationMs,
      problems: found,
      reads: reads.length,
    });
    return ok({ value: result.value.value, problems });
  };
  let withoutReader = false;
  const attempt = async (
    options?: PassOptions,
  ): Promise<Result<{ value: T; problems: string[] }, ModelError>> => {
    if (withoutReader) return attemptOnce({ ...options, withoutReader });
    const result = await attemptOnce(options);
    if (result.ok || result.error.kind !== "reader") return result;
    logger.info("Running a model pass again without the read tool", { pass });
    withoutReader = true;
    return attemptOnce({ ...options, withoutReader });
  };

  const first = await attempt();
  if (!first.ok && first.error.kind !== "invalid-output")
    return { outcome: first, usage, modelCalls };
  if (first.ok && first.value.problems.length === 0) return { outcome: first, usage, modelCalls };
  const feedback = first.ok ? first.value.problems : [first.error.message];

  logger.info("Retrying a model pass with feedback", { pass, problems: feedback.length });
  const second = await attempt({ feedback });
  if (second.ok || !first.ok) return { outcome: second, usage, modelCalls };
  logger.warn("A model pass retry failed; repairing the first answer", {
    pass,
    error: second.error.message,
  });
  return { outcome: first, usage, modelCalls };
};

/** Whether a mark's file was in the prompt, or left for the pass to read and read by it. */
const readIfLeft = (
  mark: GuidanceMark | null,
  guidance: Guidance | null,
  calls: readonly ModelCall[],
): boolean => {
  const file = guidance?.guidelines.find((one) => one.ref === mark?.ref);
  if (file === undefined || file.given === "prompt") return true;
  const path = `${HARNESS_ROOT}/${file.path}`;
  return calls.some((call) =>
    call.reads.some((read) => read.outcome === "read" && read.path === path),
  );
};

/**
 * A finding's guidance mark when it checks out against what the run was given and the pass's
 * calls read, else null: the point stays, unmarked, so the reviewer sees it as any other. Logged,
 * never retried.
 */
const checkedMark = (
  mark: GuidanceMark | null,
  guidance: Guidance | null,
  calls: readonly ModelCall[],
  logger: Logger,
  on: Readonly<Record<string, unknown>>,
): GuidanceMark | null => {
  const checked = readIfLeft(mark, guidance, calls) ? checkGuidanceMark(mark, guidance) : null;
  if (mark !== null && checked === null) {
    logger.warn("Dropped a guidance mark that doesn't check out", { ...on, ...mark });
  }
  return checked;
};

const describeUnknown = (hunkId: HunkId): string => `${hunkId} isn't a hunk of this pull request.`;

const intentTexts: Rewrite<Intent> = ({ stated, inferred, mismatches }, text) => ({
  stated: stated === null ? null : { ...stated, summary: text(stated.summary) },
  inferred: {
    summary: text(inferred.summary),
    behaviorChanges: inferred.behaviorChanges.map(text),
  },
  mismatches: mismatches.map((one) => ({ ...one, description: text(one.description) })),
});

export const runIntent = async (
  model: AnalysisModel,
  input: AnalysisInput,
  knownHunks: ReadonlySet<HunkId>,
  deps: PassDeps,
  onAnswering?: () => void,
  guidance: Guidance | null = null,
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
    refsOutOf(guidance, input, intentTexts),
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

const findingTexts: Rewrite<FindingDraft[]> = (drafts, text) =>
  drafts.map((draft) => ({
    ...draft,
    title: text(draft.title),
    explanation: text(draft.explanation),
  }));

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
    refsOutOf(guidance, input, findingTexts),
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
            guidance: checkedMark(draft.guidance, guidance, modelCalls, deps.logger, {
              finding: index + 1,
            }),
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
  readsHarness: model.readsHarness,
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

const describeFlowProblem = (problem: DataFlowProblem): string => {
  const station = `Station ${problem.station + 1} of the flow`;
  switch (problem.kind) {
    case "unknown-file":
      return `${station} lists ${problem.path}, which isn't a changed file of this pull request. Use paths as the data gives them.`;
    case "repeated-file":
      return `${station} lists ${problem.path}, which an earlier station or its own files already have. A file goes in one place.`;
    case "unnamed":
      return `${station} has no name.`;
    case "no-files":
      return `${station} has no changed file of this pull request in files.`;
    case "too-many":
      return `${station} is past the seventh. Merge neighboring stations into at most 7.`;
    case "unlinked":
      return `Nothing in the code joins station ${problem.station + 1} of the flow to station ${problem.next + 1}: none of their files calls, names or requests one of the other's. Order the stations as the data moves, or merge them.`;
  }
};

const tourTexts: Rewrite<TourDraft> = ({ steps, flow }, text) => {
  const optional = (one: string | null) => (one === null ? null : text(one));
  return {
    steps: steps.map((draft) => ({ ...draft, sentence: text(draft.sentence) })),
    flow:
      flow === null
        ? null
        : {
            source: optional(flow.source),
            stations: flow.stations.map((station) => ({
              ...station,
              name: text(station.name),
              when: optional(station.when),
              gives: optional(station.gives),
            })),
            end: optional(flow.end),
          },
  };
};

/** The steps pass's two results: the tour, or why there's none, and the data flow or none. */
export interface TourResult extends PassResult<Step[]> {
  readonly flow: DataFlow | null;
}

/**
 * The page's tour and the change's data flow: what the model wrote, checked, with one retry for
 * what the checks find in either. After it, what's still wrong is repaired as `keptSteps` and
 * `keptDataFlow` say and logged. An answer of fewer than three steps is no tour: the change is too
 * small for one. An answer the checks leave with fewer than three is no tour either, and the reason
 * is the pass's error, which the page shows. The flow stands or falls by its own checks.
 */
export const runSteps = async (
  model: AnalysisModel,
  input: AnalysisInput,
  context: StepContext,
  flowContext: DataFlowContext,
  deps: PassDeps,
  guidance: Guidance | null = null,
): Promise<TourResult> => {
  const flowProblems = (flow: DataFlow | null) =>
    flow === null ? [] : validateDataFlow(flow, flowContext);
  const { outcome, usage, modelCalls } = await callChecked(
    "steps",
    (options) => model.steps(input, options),
    refsOutOf(guidance, input, tourTexts),
    ({ steps, flow }) => [
      ...validateSteps(steps, context).map(describeStepProblem),
      ...flowProblems(flow).map(describeFlowProblem),
    ],
    deps,
  );
  if (!outcome.ok) return { outcome, usage, modelCalls, warnings: [], flow: null };
  const { steps: drafts, flow: drafted } = outcome.value.value;
  const leftInFlow = flowProblems(drafted);
  if (leftInFlow.length > 0) {
    deps.logger.warn("Repaired the data flow the checks found wrong after the retry", {
      problems: leftInFlow.map(describeFlowProblem),
    });
  }
  const flow = drafted === null ? null : keptDataFlow(drafted, flowContext);
  if (drafts.length < MIN_STEPS) return { outcome: ok([]), usage, modelCalls, warnings: [], flow };
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
      flow,
    };
  }
  return { outcome: ok(steps), usage, modelCalls, warnings: [], flow };
};
