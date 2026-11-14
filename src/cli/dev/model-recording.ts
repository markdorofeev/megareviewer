import { z } from "zod";
import {
  type AnalysisInput,
  type AnalysisModel,
  DecisionDraft,
  FindingDraft,
  ModelRisk,
  type PassOptions,
  type PassOutput,
} from "../../application/ports/index.ts";
import {
  Intent,
  type ModelError,
  type ModelErrorKind,
  type ModelPass,
  ModelUsage,
} from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";

/** One pass as it ran: what it answered, how long it took, and what it used. */
const RecordedPass = z
  .object({
    answer: z.unknown(),
    durationMs: z.number().nonnegative(),
    usage: ModelUsage,
  })
  .readonly();

/** A real run of the passes on one pull request, replayed with its own timing. */
export const ModelRecording = z
  .object({
    pullRequestUrl: z.string(),
    headSha: z.string(),
    /** The model version that answered, for the record. */
    version: z.string(),
    recordedAt: z.string(),
    passes: z.object({
      intent: RecordedPass,
      findings: RecordedPass,
      risk: RecordedPass,
      decisions: RecordedPass,
    }),
  })
  .readonly();
export type ModelRecording = z.infer<typeof ModelRecording>;

/** The scenarios the recording can be played as. */
export const SCENARIOS = [
  "ready",
  "slow",
  "nothing-found",
  "many",
  "limit-after-findings",
  "refusal",
  "invalid-then-ok",
  "not-signed-in",
] as const;
export type Scenario = (typeof SCENARIOS)[number];

export const isScenario = (name: string): name is Scenario =>
  (SCENARIOS as readonly string[]).includes(name);

/** How much slower than recorded each scenario plays. */
const SPEED: Partial<Record<Scenario, number>> = { slow: 3 };

/** Points the "many" scenario makes, to test the list, Next and the tree. */
const MANY = 40;

const modelError = (kind: ModelErrorKind, message: string): ModelError => ({ kind, message });

const RESET_AT = "2026-11-13 18:00";

const SCENARIO_ERRORS: Partial<Record<Scenario, Partial<Record<ModelPass, ModelError>>>> = {
  "limit-after-findings": {
    risk: modelError(
      "rate-limited",
      `Your Claude plan's usage limit is reached. It resets at ${RESET_AT}.`,
    ),
    decisions: modelError(
      "rate-limited",
      `Your Claude plan's usage limit is reached. It resets at ${RESET_AT}.`,
    ),
  },
  refusal: { findings: modelError("refusal", "Claude declined to answer this task.") },
  "not-signed-in": Object.fromEntries(
    (["intent", "findings", "risk", "decisions"] as const).map((pass) => [
      pass,
      modelError("unauthorized", "Claude Code isn't signed in. Run `claude` and sign in."),
    ]),
  ),
};

/** Parses a pass's recorded answer, which the recording holds as the model wrote it. */
const parsed = <T>(schema: z.ZodType<T>, answer: unknown, pass: ModelPass): T => {
  const result = schema.safeParse(answer);
  if (!result.success) {
    throw new Error(
      `The recording's ${pass} answer doesn't parse: ${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
};

export interface ReplayOptions {
  readonly scenario?: Scenario;
  /** Waits this long per recorded millisecond; 0 answers at once, for tests. */
  readonly speed?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * An `AnalysisModel` that answers from a recording of a real run, with its timing, times a speed
 * factor. A scenario changes what it answers: nothing found, a plan limit after the findings, a
 * refusal, an invalid answer that the retry fixes, or no sign-in. Never bundled.
 */
export const createReplayAnalysisModel = (
  recording: ModelRecording,
  options: ReplayOptions = {},
): AnalysisModel => {
  const scenario: Scenario = options.scenario ?? "ready";
  const speed = options.speed ?? SPEED[scenario] ?? 1;
  const sleep = options.sleep ?? wait;
  const failed = new Set<ModelPass>();

  const play = async <T>(
    pass: ModelPass,
    passOptions: PassOptions | undefined,
    value: (answer: unknown) => T,
    invalid: () => unknown,
  ): Promise<Result<PassOutput<T>, ModelError>> => {
    const recorded = recording.passes[pass];
    // A replay has no cache to wait for.
    passOptions?.onAnswering?.();
    await sleep(recorded.durationMs * speed);
    const failure = SCENARIO_ERRORS[scenario]?.[pass];
    if (failure !== undefined) return err(failure);
    // The first attempt of every pass answers badly; the retry, with feedback, answers well.
    const retrying = passOptions?.feedback !== undefined;
    if (scenario === "invalid-then-ok" && !retrying && !failed.has(pass)) {
      failed.add(pass);
      return ok({ value: value(invalid()) as T, usage: recorded.usage });
    }
    return ok({ value: value(recorded.answer), usage: recorded.usage });
  };

  const findingsOf = (answer: unknown): FindingDraft[] => {
    const recorded = parsed(z.array(FindingDraft), answer, "findings");
    return scenario === "nothing-found" ? [] : recorded;
  };
  const decisionsOf = (answer: unknown): DecisionDraft[] => {
    const recorded = parsed(z.array(DecisionDraft), answer, "decisions");
    if (scenario === "nothing-found") return [];
    if (scenario !== "many" || recorded.length === 0) return recorded;
    return Array.from({ length: MANY }, (_, index) => {
      const draft = recorded[index % recorded.length];
      if (draft === undefined) throw new Error("unreachable: recorded is not empty");
      return { ...draft, title: `${draft.title} (${index + 1})` };
    });
  };
  const riskOf = (answer: unknown): ModelRisk[] => {
    const recorded = parsed(z.array(ModelRisk), answer, "risk");
    return scenario === "nothing-found"
      ? recorded.map((risk) => ({ ...risk, riskClass: "logic" as const }))
      : recorded;
  };

  return {
    version: `replay/${scenario}`,
    async checkSize() {
      return ok({ inputTokens: recording.passes.intent.usage.inputTokens });
    },
    intent: (_input: AnalysisInput, passOptions?: PassOptions) =>
      play(
        "intent",
        passOptions,
        (answer) => parsed(Intent, answer, "intent"),
        () => ({
          ...parsed(Intent, recording.passes.intent.answer, "intent"),
          mismatches: [{ kind: "missing", description: "x", hunkIds: ["h_ffffffffffffffff"] }],
        }),
      ),
    findings: (_input, passOptions) =>
      play("findings", passOptions, findingsOf, () =>
        findingsOf(recording.passes.findings.answer).map((finding) => ({
          ...finding,
          lines: { ...finding.lines, startLine: 100_000, line: 100_001 },
        })),
      ),
    risk: (_input, passOptions) => play("risk", passOptions, riskOf, () => []),
    decisions: (_input, passOptions) =>
      play("decisions", passOptions, decisionsOf, () =>
        decisionsOf(recording.passes.decisions.answer).map((draft) => ({
          ...draft,
          hunkIds: ["h_ffffffffffffffff"],
        })),
      ),
  };
};
