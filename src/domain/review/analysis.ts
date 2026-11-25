import { z } from "zod";
import {
  CallGraphHint,
  CallSite,
  FileChange,
  FileLink,
  HunkPart,
  MechanicalProof,
  UnchangedCallers,
} from "../diff/index.ts";
import { fnv1a64 } from "../shared/index.ts";
import { ModelError } from "./errors.ts";
import { Flow, storedFlows } from "./flows.ts";
import { Intent, Ticket } from "./intent.ts";
import { ModelRunOption } from "./model-option.ts";
import { Finding } from "./point.ts";
import { Guidance } from "./preference.ts";
import { Sha, Timestamp } from "./primitives.ts";
import { PullRequest, PullRequestRef } from "./pull-request.ts";
import { RiskAssessment } from "./risk.ts";
import { Step } from "./step.ts";

export const StageName = z.enum(["collect", "prep", "intent", "findings", "steps"]);
export type StageName = z.infer<typeof StageName>;

/** skipped: a model pass that didn't run because the model is off. */
export const StageStatus = z.enum(["pending", "running", "done", "failed", "skipped"]);
export type StageStatus = z.infer<typeof StageStatus>;

export const AnalysisId = z
  .string()
  .regex(/^a_[0-9a-f]{16}$/)
  .brand<"AnalysisId">();
export type AnalysisId = z.infer<typeof AnalysisId>;

/** Changes whenever the pipeline or the model passes change, e.g. "1+claude-opus-5-5/p3". */
export const PipelineVersion = z.string().min(1);
export type PipelineVersion = z.infer<typeof PipelineVersion>;

export const AnalysisKey = z
  .object({
    ref: PullRequestRef,
    headSha: Sha,
    pipelineVersion: PipelineVersion,
  })
  .readonly();
export type AnalysisKey = z.infer<typeof AnalysisKey>;

export const ModelPass = z.enum(["intent", "findings", "steps"]);
export type ModelPass = z.infer<typeof ModelPass>;

/**
 * What a model call of a run was: one of the passes, or the guardrail call after them. Runs stored
 * while there were a risk and a decisions pass have theirs.
 */
export const ModelCallName = z.enum([...ModelPass.options, "guardrails", "risk", "decisions"]);
export type ModelCallName = z.infer<typeof ModelCallName>;

/** The guardrail call of a model run: running after the passes, then what came of it. */
export const GuardrailCallStatus = z.enum(["running", "done", "failed"]);
export type GuardrailCallStatus = z.infer<typeof GuardrailCallStatus>;

const TokenCount = z.number().int().nonnegative();

/** Who pays for the tokens: the reviewer's API account, or nobody per call on their Claude plan. */
export const ModelBilling = z.enum(["api", "plan"]);
export type ModelBilling = z.infer<typeof ModelBilling>;

export const ModelUsage = z
  .object({
    pass: ModelCallName,
    inputTokens: TokenCount,
    cacheReadTokens: TokenCount,
    cacheWriteTokens: TokenCount,
    outputTokens: TokenCount,
    /**
     * Under "plan", what the tokens would cost at API prices: nothing is charged per call. Null
     * for a model with no known price, which Codex reports tokens for and no cost.
     */
    costUsd: z.number().nonnegative().nullable(),
    // Analyses stored before there was a plan transport were all billed to the API.
    billing: ModelBilling.default("api"),
    // Absent on analyses stored before passes were timed.
    startedAt: Timestamp.optional(),
    durationMs: z.number().int().nonnegative().optional(),
  })
  .readonly();
export type ModelUsage = z.infer<typeof ModelUsage>;

/** An answer the checks passed, one they found problems in, or no answer. */
export const ModelCallOutcome = z.enum(["ok", "problems", "failed"]);
export type ModelCallOutcome = z.infer<typeof ModelCallOutcome>;

/** One call of a pass, kept to trace a run: when it ran, and why it was retried or failed. */
export const ModelCall = z
  .object({
    pass: ModelCallName,
    /** 2 for the retry the checks' problems asked for. */
    attempt: z.number().int().positive(),
    startedAt: Timestamp,
    durationMs: z.number().int().nonnegative(),
    outcome: ModelCallOutcome,
    /** What the checks found wrong with the answer: what a retry is told, or what was dropped. */
    problems: z.array(z.string()).readonly(),
    error: ModelError.nullable(),
  })
  .readonly();
export type ModelCall = z.infer<typeof ModelCall>;

export const AnalysisError = z
  .object({
    stage: StageName,
    code: z.string().min(1),
    message: z.string(),
  })
  .readonly();
export type AnalysisError = z.infer<typeof AnalysisError>;

/** Analyses stored while the model titled the tour have a pass for it, which is left out. */
const withoutTourPass = (entries: unknown) =>
  Array.isArray(entries)
    ? entries.filter(
        (entry: unknown) =>
          typeof entry !== "object" ||
          entry === null ||
          !("pass" in entry) ||
          entry.pass !== "tour",
      )
    : entries;

export const MODEL_STAGES = ["intent", "findings"] as const satisfies readonly StageName[];

/** The stages of passes the model no longer makes, on analyses stored while it did. */
const REMOVED_STAGES: readonly string[] = ["tour", "risk", "decisions"];

/**
 * Analyses stored before the findings pass lack its stage, and those stored before the steps pass
 * lack that; the stages of passes since removed are left out.
 */
const currentStages = (stages: unknown) => {
  if (typeof stages !== "object" || stages === null) return stages;
  return Object.fromEntries(
    Object.entries({ findings: "skipped", steps: "skipped", ...stages }).filter(
      ([stage]) => !REMOVED_STAGES.includes(stage),
    ),
  );
};

/**
 * The error of a run stored with the stage of a pass since removed. The run's intent and findings
 * come first, so it's no error of theirs, unless one of them didn't finish.
 */
const currentModelError = (stored: Readonly<Record<string, unknown>>) => {
  const { modelError, stages } = stored;
  if (typeof modelError !== "object" || modelError === null || !("stage" in modelError)) return {};
  const stage = String(modelError.stage);
  if (!REMOVED_STAGES.includes(stage)) return {};
  const unfinished = MODEL_STAGES.find(
    (name) => typeof stages === "object" && stages !== null && Reflect.get(stages, name) !== "done",
  );
  return { modelError: unfinished === undefined ? null : { ...modelError, stage: unfinished } };
};

export const AnalysisStatus = z.enum(["running", "complete", "failed"]);
export type AnalysisStatus = z.infer<typeof AnalysisStatus>;

/** How far Collect is through fetching the PR's files, counting those already cached. */
export const FilesFetched = z
  .object({ done: z.number().int().nonnegative(), total: z.number().int().nonnegative() })
  .readonly();
export type FilesFetched = z.infer<typeof FilesFetched>;

/**
 * Whether the analysis read the PR's repository from a checkout: "read", or why not. "none": no
 * checkout of the repository was found. "missing-commit": one was, without the PR's head commit.
 * "downloading": the commit is being downloaded into megareviewer's own copy, and the callers come
 * when it ends. "download-failed": it wasn't, for the reason in `checkoutError`.
 */
export const CheckoutStatus = z.enum([
  "read",
  "none",
  "missing-commit",
  "downloading",
  "download-failed",
]);
export type CheckoutStatus = z.infer<typeof CheckoutStatus>;

/** The fields of an analysis a model run changes, as the code made them. */
export const BeforeModel = z
  .object({
    /** Kept by runs stored while the model classified hunks, which changed it. */
    risk: z.array(RiskAssessment).readonly().optional(),
    warnings: z.array(z.string()).readonly(),
  })
  .readonly();
export type BeforeModel = z.infer<typeof BeforeModel>;

/**
 * Analyses stored before the code's flows were named so keep them under `tour`: read into `flows`,
 * whose own shapes `storedFlows` reads, so the cache still serves them.
 */
const flowsUnderOldName = (stored: object) =>
  "tour" in stored && !("flows" in stored)
    ? Object.fromEntries(
        Object.entries(stored).map(([key, value]) => [key === "tour" ? "flows" : key, value]),
      )
    : stored;

const currentAnalysis = (stored: unknown) => {
  if (typeof stored !== "object" || stored === null) return stored;
  const renamed = flowsUnderOldName(stored);
  return { ...renamed, ...currentModelError(Object.fromEntries(Object.entries(renamed))) };
};

export const Analysis = z.preprocess(
  currentAnalysis,
  z
    .object({
      id: AnalysisId,
      key: AnalysisKey,
      status: AnalysisStatus,
      stages: z.preprocess(currentStages, z.record(StageName, StageStatus)).readonly(),
      /** null until Collect starts fetching. Defaults for analyses stored before it existed. */
      filesFetched: FilesFetched.nullable().default(null),
      pullRequest: PullRequest.nullable(),
      files: z.array(FileChange).readonly(),
      tickets: z.array(Ticket).readonly(),
      /** Ticket keys found in the PR that Jira didn't return. */
      missingTicketKeys: z.array(z.string()).readonly(),
      proofs: z.array(MechanicalProof).readonly(),
      /** The parts of split hunks, in diff order. A hunk with none here is one part. */
      parts: z.array(HunkPart).readonly(),
      callGraph: z.array(CallGraphHint).readonly(),
      /** Defaults for analyses stored before it existed. */
      callSites: z.array(CallSite).readonly().default([]),
      /** Changed files an import in another changed file reaches. */
      fileLinks: z.array(FileLink).readonly(),
      /** Paths whose first lines say a tool wrote them. Grouped and faded, never hidden. */
      generated: z.array(z.string()).readonly(),
      checkout: CheckoutStatus,
      /**
       * The folder the checkout is in: the one read, or the one that lacks the PR's head commit. Null
       * when none was found, and on analyses stored before it was kept.
       */
      checkoutDir: z.string().nullable().default(null),
      /** Why the commit couldn't be downloaded, and what would fix it; null unless it failed. */
      checkoutError: z.string().nullable().default(null),
      /** Read from the checkout: uses outside the PR of the definitions it changes. */
      unchangedCallers: z.array(UnchangedCallers).readonly(),
      intent: Intent.nullable(),
      /** Defaults for analyses stored before the findings pass. */
      findings: z.array(Finding).readonly().default([]),
      risk: z.array(RiskAssessment).readonly(),
      /** The code's flows from the call graph, which order and label the overview. */
      flows: z.preprocess(storedFlows, z.array(Flow).readonly().nullable()),
      /** The page's tour, which the steps pass writes; null when no run asked for it. */
      steps: z.array(Step).readonly().nullable().default(null),
      /**
       * Why a run that asked for the tour has none: the steps pass failed, or its checks left fewer
       * than three steps. Never the run's `modelError`: the review is there without a tour.
       */
      stepsError: AnalysisError.nullable().default(null),
      warnings: z.array(z.string()).readonly(),
      usage: z.preprocess(withoutTourPass, z.array(ModelUsage)).readonly(),
      /** Defaults for analyses stored before model calls were traced. */
      modelCalls: z.preprocess(withoutTourPass, z.array(ModelCall)).readonly().default([]),
      /** Why the analysis failed; never set by the model passes, which have `modelError`. */
      error: AnalysisError.nullable(),
      /**
       * Why the last model run failed. The analysis itself stays complete: the code's review is
       * there with or without the model.
       */
      modelError: AnalysisError.nullable().default(null),
      /** The option the model run used. Absent on analyses stored before the choice, all Haiku 5.5. */
      modelOption: ModelRunOption.nullable().default(null),
      /** The preferences and guideline files the model run was given; null without a run. */
      guidance: Guidance.nullable().default(null),
      /**
       * What the code made of the fields a model run changes, kept when the first run starts so that
       * removing the run puts them back. Null without a run, and where a run started before it was kept.
       */
      beforeModel: BeforeModel.nullable().default(null),
      /** The run's guardrail call; null when it didn't make one. Never a stage: the review lands without it. */
      guardrails: GuardrailCallStatus.nullable().default(null),
      createdAt: Timestamp,
      updatedAt: Timestamp,
    })
    .readonly(),
);
export type Analysis = z.infer<typeof Analysis>;

/**
 * The stage of the pass that writes the page's tour. It runs only when a run asks for it, and isn't
 * one of the review's two: they decide whether the run worked, and it never does.
 */
export const STEPS_STAGE = "steps" as const satisfies StageName;

const RUN_STAGES = [...MODEL_STAGES, STEPS_STAGE] as const;

/** The stages a model run counts: the review's two, and the steps pass when it asked for the tour. */
export const runStages = (analysis: Pick<Analysis, "stages">): readonly StageName[] =>
  analysis.stages.steps === "skipped" ? MODEL_STAGES : RUN_STAGES;

/** The stages with each model stage's status, the steps pass's too, replaced by `next` of it. */
export const mapModelStages = (
  stages: Analysis["stages"],
  next: (status: StageStatus) => StageStatus,
): Analysis["stages"] => ({
  ...stages,
  intent: next(stages.intent),
  findings: next(stages.findings),
  steps: next(stages.steps),
});

/**
 * Still changing: the code's stages are running, or the model is, the steps pass among it. Once the
 * code's are done, a model stage is pending only while a run hasn't reached it; when they fail, the
 * model's stay pending and never run.
 */
export const inProgress = (analysis: Pick<Analysis, "status" | "stages">): boolean =>
  analysis.status === "running" ||
  (analysis.status === "complete" &&
    RUN_STAGES.some(
      (stage) => analysis.stages[stage] === "running" || analysis.stages[stage] === "pending",
    ));

/**
 * Whether its events still stream: it's in progress, its run's guardrail call is running, or the
 * commit its callers are read from is being downloaded.
 */
export const following = (
  analysis: Pick<Analysis, "status" | "stages" | "guardrails" | "checkout">,
): boolean =>
  inProgress(analysis) ||
  analysis.guardrails === "running" ||
  (analysis.status === "complete" && analysis.checkout === "downloading");

/** Whether the model can be asked to run: the code's analysis is complete and the model isn't running or done. */
export const modelRunnable = (analysis: Pick<Analysis, "status" | "stages">): boolean =>
  analysis.status === "complete" &&
  !inProgress(analysis) &&
  !MODEL_STAGES.every((stage) => analysis.stages[stage] === "done");

/** Whether Claude has run on the analysis, whatever came of it. */
export const hasModelRun = (analysis: Pick<Analysis, "stages" | "usage" | "modelError">): boolean =>
  MODEL_STAGES.some((stage) => analysis.stages[stage] !== "skipped") ||
  analysis.usage.length > 0 ||
  analysis.modelError !== null;

/**
 * The analysis as if no model had run on it: the model's results gone, its stages not run, and the
 * fields it changed back to what the code made of them.
 */
export const withoutModelRun = (
  analysis: Analysis,
  code: BeforeModel,
  updatedAt: Timestamp,
): Analysis => ({
  ...analysis,
  stages: mapModelStages(analysis.stages, () => "skipped"),
  intent: null,
  findings: [],
  risk: code.risk ?? analysis.risk,
  steps: null,
  stepsError: null,
  warnings: code.warnings,
  usage: [],
  modelCalls: [],
  modelError: null,
  modelOption: null,
  guidance: null,
  beforeModel: null,
  guardrails: null,
  updatedAt,
});

/** What to keep when a model run starts: the code's fields, unless a run has changed them. */
export const keepBeforeModel = (analysis: Analysis): BeforeModel | null =>
  analysis.beforeModel ?? (hasModelRun(analysis) ? null : { warnings: analysis.warnings });

/** Deterministic, so the same PR at the same head SHA and pipeline version maps to one analysis. */
export const analysisId = (key: AnalysisKey): AnalysisId => {
  const { host, owner, repo } = key.ref.repo;
  const input = `${host}/${owner}/${repo}#${key.ref.number}@${key.headSha}+${key.pipelineVersion}`;
  return AnalysisId.parse(`a_${fnv1a64(input)}`);
};
