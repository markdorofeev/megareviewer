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
  type Intent,
  type ModelError,
  type ModelUsage,
  type Ticket,
  TourStep,
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
  })
  .readonly();
export type ModelRisk = z.infer<typeof ModelRisk>;

export const DecisionDraft = Decision.unwrap().omit({ id: true }).readonly();
export type DecisionDraft = z.infer<typeof DecisionDraft>;

/**
 * The model writes steps without `kind`, `via` and `entries`: its steps are all flows that repeat
 * nothing, and it doesn't say where they start.
 */
export const TourStepDraft = TourStep.unwrap()
  .omit({ id: true, kind: true, via: true, entries: true })
  .readonly();
export type TourStepDraft = z.infer<typeof TourStepDraft>;

export const TourDraft = z.object({ steps: z.array(TourStepDraft).readonly() }).readonly();
export type TourDraft = z.infer<typeof TourDraft>;

export interface AnalysisModel {
  /** Changes whenever prompts, schemas or the model change. Part of the cache key. */
  readonly version: string;
  /** Fails with "too-large" if the input can't fit the configured budget. */
  checkSize(input: AnalysisInput): Promise<Result<{ inputTokens: number }, ModelError>>;
  intent(
    input: AnalysisInput,
    options?: PassOptions,
  ): Promise<Result<PassOutput<Intent>, ModelError>>;
  risk(
    input: AnalysisInput,
    intent: Intent,
    options?: PassOptions,
  ): Promise<Result<PassOutput<ModelRisk[]>, ModelError>>;
  decisions(
    input: AnalysisInput,
    intent: Intent,
    options?: PassOptions,
  ): Promise<Result<PassOutput<DecisionDraft[]>, ModelError>>;
  tour(
    input: AnalysisInput,
    intent: Intent,
    risk: readonly ModelRisk[],
    decisions: readonly Decision[],
    options?: PassOptions,
  ): Promise<Result<PassOutput<TourDraft>, ModelError>>;
}
