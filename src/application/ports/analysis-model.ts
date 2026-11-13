import { z } from "zod";
import {
  type CallGraphHint,
  type FileStatus,
  type Hunk,
  HunkId,
  type HunkPart,
  type MechanicalProof,
} from "../../domain/diff/index.ts";
import {
  type Commit,
  Decision,
  Finding,
  type Intent,
  type ModelError,
  type ModelUsage,
  type Ticket,
  type Tour,
  TourStepTitle,
  TourTitles,
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

/** A finding as the model writes it; the server numbers them. */
export const FindingDraft = Finding.unwrap().omit({ id: true }).readonly();
export type FindingDraft = z.infer<typeof FindingDraft>;

export const DecisionDraft = Decision.unwrap().omit({ id: true }).readonly();
export type DecisionDraft = z.infer<typeof DecisionDraft>;

/**
 * The tour pass titles the code's tour: a title and explanation per step, by the step's ID, and
 * merges of supporting steps into the steps they belong with. It can't move or drop a part.
 */
export const TourStepDraft = TourStepTitle;
export type TourStepDraft = TourStepTitle;

export const TourDraft = TourTitles;
export type TourDraft = TourTitles;

/** The code's tour as the tour pass reads it: its steps, and the parts they name. */
export interface TourSkeleton {
  readonly tour: Tour;
  /** Split hunks' parts; a part ID that isn't here is a whole hunk. */
  readonly parts: readonly HunkPart[];
}

/** Whether the model passes can run now: what runs them and who pays, or why they can't. */
export type ModelAvailability =
  | { readonly available: true; readonly via: string }
  | { readonly available: false; readonly reason: string };

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
    intent: Intent,
    options?: PassOptions,
  ): Promise<Result<PassOutput<FindingDraft[]>, ModelError>>;
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
    skeleton: TourSkeleton,
    options?: PassOptions,
  ): Promise<Result<PassOutput<TourDraft>, ModelError>>;
}
