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
import { Decision } from "./decision.ts";
import { ModelError } from "./errors.ts";
import { Intent, Ticket } from "./intent.ts";
import { ModelRunOption } from "./model-option.ts";
import { Finding } from "./point.ts";
import { Sha, Timestamp } from "./primitives.ts";
import { PullRequest, PullRequestRef } from "./pull-request.ts";
import { RiskAssessment } from "./risk.ts";
import { Tour } from "./tour.ts";

export const StageName = z.enum(["collect", "prep", "intent", "findings", "risk", "decisions"]);
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

export const ModelPass = z.enum(["intent", "findings", "risk", "decisions"]);
export type ModelPass = z.infer<typeof ModelPass>;

const TokenCount = z.number().int().nonnegative();

/** Who pays for the tokens: the reviewer's API account, or nobody per call on their Claude plan. */
export const ModelBilling = z.enum(["api", "plan"]);
export type ModelBilling = z.infer<typeof ModelBilling>;

export const ModelUsage = z
  .object({
    pass: ModelPass,
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
    pass: ModelPass,
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

/**
 * Analyses stored before the findings pass lack its stage; those from while the model titled the
 * tour have a stage for that, which is left out.
 */
const currentStages = (stages: unknown) => {
  if (typeof stages !== "object" || stages === null) return stages;
  return Object.fromEntries(
    Object.entries({ findings: "skipped", ...stages }).filter(([stage]) => stage !== "tour"),
  );
};

export const AnalysisStatus = z.enum(["running", "complete", "failed"]);
export type AnalysisStatus = z.infer<typeof AnalysisStatus>;

/** How far Collect is through fetching the PR's files, counting those already cached. */
export const FilesFetched = z
  .object({ done: z.number().int().nonnegative(), total: z.number().int().nonnegative() })
  .readonly();
export type FilesFetched = z.infer<typeof FilesFetched>;

/**
 * Whether the analysis read the PR's repository from a local checkout: "read", or why not. "none":
 * no checkout of the repository was found. "missing-commit": one was, without the PR's head commit.
 */
export const CheckoutStatus = z.enum(["read", "none", "missing-commit"]);
export type CheckoutStatus = z.infer<typeof CheckoutStatus>;

export const Analysis = z
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
    /** Read from the checkout: uses outside the PR of the definitions it changes. */
    unchangedCallers: z.array(UnchangedCallers).readonly(),
    intent: Intent.nullable(),
    /** Defaults for analyses stored before the findings pass. */
    findings: z.array(Finding).readonly().default([]),
    risk: z.array(RiskAssessment).readonly(),
    decisions: z.array(Decision).readonly(),
    tour: Tour.nullable(),
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
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .readonly();
export type Analysis = z.infer<typeof Analysis>;

export const MODEL_STAGES = [
  "intent",
  "findings",
  "risk",
  "decisions",
] as const satisfies readonly StageName[];

/** The stages with each model stage's status replaced by `next` of it. */
export const mapModelStages = (
  stages: Analysis["stages"],
  next: (status: StageStatus) => StageStatus,
): Analysis["stages"] => ({
  ...stages,
  intent: next(stages.intent),
  findings: next(stages.findings),
  risk: next(stages.risk),
  decisions: next(stages.decisions),
});

/**
 * Still changing: the code's stages are running, or the model is. Once the code's are done, a
 * model stage is pending only while a run hasn't reached it; when they fail, the model's stay
 * pending and never run.
 */
export const inProgress = (analysis: Pick<Analysis, "status" | "stages">): boolean =>
  analysis.status === "running" ||
  (analysis.status === "complete" &&
    MODEL_STAGES.some(
      (stage) => analysis.stages[stage] === "running" || analysis.stages[stage] === "pending",
    ));

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

/** Deterministic, so the same PR at the same head SHA and pipeline version maps to one analysis. */
export const analysisId = (key: AnalysisKey): AnalysisId => {
  const { host, owner, repo } = key.ref.repo;
  const input = `${host}/${owner}/${repo}#${key.ref.number}@${key.headSha}+${key.pipelineVersion}`;
  return AnalysisId.parse(`a_${fnv1a64(input)}`);
};
