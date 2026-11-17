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
  GuidanceMark,
  type GuidanceRef,
  type Intent,
  type ModelError,
  type ModelUsage,
  PointLines,
  type PreferenceKind,
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
  readonly guidance: InputGuidance;
}

/**
 * What the reviewer wants the passes to look for and leave out, and the repository's guideline
 * files, each by the ref a finding or a risk marks it with. Both empty when there's none.
 */
export interface InputGuidance {
  readonly preferences: readonly {
    readonly ref: GuidanceRef;
    readonly kind: PreferenceKind;
    readonly text: string;
    /** Everywhere, or the pull request's repository. */
    readonly scope: "global" | "repo";
  }[];
  readonly guidelines: readonly {
    readonly ref: GuidanceRef;
    readonly path: string;
    readonly content: string;
  }[];
}

export const NO_GUIDANCE: InputGuidance = { preferences: [], guidelines: [] };

export interface PassOutput<T> {
  readonly value: T;
  readonly usage: ModelUsage;
}

export interface PassOptions {
  /** Validation problems with the previous attempt's output, for the model to fix. */
  readonly feedback?: readonly string[];
  /**
   * Called once the model has read the input and begun its answer, which is when the input is in
   * the prompt cache. A transport that can't tell doesn't call it.
   */
  readonly onAnswering?: () => void;
}

// Output schemas of the passes whose shape isn't a domain type as is. Model output is untrusted
// input: the adapter parses it with these before returning it.

/** A test the model says checks a risk: head-side lines of a test hunk, so no side. */
export const ModelCheckingTest = z
  .object({
    hunkId: HunkId,
    test: z.string(),
    startLine: z.number().int().positive(),
    line: z.number().int().positive(),
    checks: z.string(),
  })
  .readonly();
export type ModelCheckingTest = z.infer<typeof ModelCheckingTest>;

export const ModelRisk = z
  .object({
    hunkId: HunkId,
    riskClass: z.enum(["logic", "contract"]),
    reason: z.string(),
    /** For a contract hunk, the lines where the risk is decided; null for logic. */
    lines: PointLines.nullable().default(null),
    /** For a contract hunk, the test whose assertions check what the reason says; else null. */
    checkedBy: ModelCheckingTest.nullable().default(null),
    /** The preference or guideline file that made it contract, or says to leave it out. */
    guidance: GuidanceMark.nullable().default(null),
  })
  .readonly();
export type ModelRisk = z.infer<typeof ModelRisk>;

/** A finding as the model writes it; the server numbers them. */
export const FindingDraft = Finding.unwrap().omit({ id: true }).readonly();
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
  /** Reads the intent's answer, to name the mismatch a finding shows; null when it has none. */
  findings(
    input: AnalysisInput,
    intent: Intent | null,
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
