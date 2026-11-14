import { z } from "zod";
import {
  type CallGraphHint,
  type FileStatus,
  type Hunk,
  HunkId,
  type MechanicalProof,
} from "../../domain/diff/index.ts";
import {
  type Commit,
  Decision,
  Finding,
  type Intent,
  type ModelError,
  type ModelUsage,
  PointLines,
  type Ticket,
} from "../../domain/review/index.ts";
import type { Result } from "../../domain/shared/index.ts";

export interface AnalysisInputFile {
  readonly path: string;
  readonly oldPath: string | null;
  readonly status: FileStatus;
  readonly language: string | null;
  /** Every hunk in the file has a mechanical proof. */
  readonly mechanical: boolean;
  /** Hunks without a proof, with full lines. */
  readonly hunks: readonly Hunk[];
  /** Hunks with a proof, sent as stats only. */
  readonly mechanicalHunks: readonly {
    readonly hunkId: HunkId;
    readonly proof: MechanicalProof;
    readonly additions: number;
    readonly deletions: number;
  }[];
  /** Full new-side content, when it fits the budget. */
  readonly headContent: string | null;
}

export interface AnalysisInput {
  readonly pullRequest: {
    readonly title: string;
    readonly description: string;
    readonly sourceBranch: string;
    readonly targetBranch: string;
    readonly commits: readonly Commit[];
    readonly url: string;
  };
  readonly tickets: readonly Ticket[];
  readonly files: readonly AnalysisInputFile[];
  readonly callGraph: readonly CallGraphHint[];
}

export interface PassOutput<T> {
  readonly value: T;
  readonly usage: ModelUsage;
}

export interface PassOptions {
  /** Validation problems with the previous attempt's output, for the model to fix. */
  readonly feedback?: readonly string[];
}

// Output schemas of the passes whose shape isn't a domain type as is. Model output is untrusted
// input: the adapter parses it with these before returning it.

export const ModelRisk = z
  .object({
    hunkId: HunkId,
    riskClass: z.enum(["logic", "contract"]),
    reason: z.string(),
    /** For a contract hunk, the lines where the risk is decided; null for logic. */
    lines: PointLines.nullable().default(null),
  })
  .readonly();
export type ModelRisk = z.infer<typeof ModelRisk>;

/**
 * A finding as the model writes it. The server numbers them, and links each to a mismatch of the
 * intent, which runs beside it.
 */
export const FindingDraft = Finding.unwrap().omit({ id: true, mismatch: true }).readonly();
export type FindingDraft = z.infer<typeof FindingDraft>;

export const DecisionDraft = Decision.unwrap().omit({ id: true }).readonly();
export type DecisionDraft = z.infer<typeof DecisionDraft>;

export interface AnalysisModel {
  /** Changes whenever prompts, schemas or the model change. Part of the cache key. */
  readonly version: string;
  /** Fails with "too-large" if the input can't fit the configured budget. */
  checkSize(input: AnalysisInput): Promise<Result<{ inputTokens: number }, ModelError>>;
  intent(
    input: AnalysisInput,
    options?: PassOptions,
  ): Promise<Result<PassOutput<Intent>, ModelError>>;
  findings(
    input: AnalysisInput,
    options?: PassOptions,
  ): Promise<Result<PassOutput<FindingDraft[]>, ModelError>>;
  risk(
    input: AnalysisInput,
    options?: PassOptions,
  ): Promise<Result<PassOutput<ModelRisk[]>, ModelError>>;
  decisions(
    input: AnalysisInput,
    options?: PassOptions,
  ): Promise<Result<PassOutput<DecisionDraft[]>, ModelError>>;
}
