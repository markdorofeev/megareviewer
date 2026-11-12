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
import { Intent, Ticket } from "./intent.ts";
import { Sha, Timestamp } from "./primitives.ts";
import { PullRequest, PullRequestRef } from "./pull-request.ts";
import { RiskAssessment } from "./risk.ts";
import { Tour } from "./tour.ts";

export const StageName = z.enum(["collect", "prep", "intent", "risk", "decisions", "tour"]);
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

export const ModelPass = z.enum(["intent", "risk", "decisions", "tour"]);
export type ModelPass = z.infer<typeof ModelPass>;

const TokenCount = z.number().int().nonnegative();

export const ModelUsage = z
  .object({
    pass: ModelPass,
    inputTokens: TokenCount,
    cacheReadTokens: TokenCount,
    cacheWriteTokens: TokenCount,
    outputTokens: TokenCount,
    costUsd: z.number().nonnegative(),
  })
  .readonly();
export type ModelUsage = z.infer<typeof ModelUsage>;

export const AnalysisError = z
  .object({
    stage: StageName,
    code: z.string().min(1),
    message: z.string(),
  })
  .readonly();
export type AnalysisError = z.infer<typeof AnalysisError>;

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
    stages: z.record(StageName, StageStatus).readonly(),
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
    risk: z.array(RiskAssessment).readonly(),
    decisions: z.array(Decision).readonly(),
    tour: Tour.nullable(),
    warnings: z.array(z.string()).readonly(),
    usage: z.array(ModelUsage).readonly(),
    error: AnalysisError.nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .readonly();
export type Analysis = z.infer<typeof Analysis>;

/** Deterministic, so the same PR at the same head SHA and pipeline version maps to one analysis. */
export const analysisId = (key: AnalysisKey): AnalysisId => {
  const { host, owner, repo } = key.ref.repo;
  const input = `${host}/${owner}/${repo}#${key.ref.number}@${key.headSha}+${key.pipelineVersion}`;
  return AnalysisId.parse(`a_${fnv1a64(input)}`);
};
