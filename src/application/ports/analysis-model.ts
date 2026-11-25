import type { z } from "zod";
import type {
  CallGraphHint,
  FileStatus,
  Hunk,
  HunkId,
  MechanicalProof,
  UnchangedUse,
} from "../../domain/diff/index.ts";
import {
  type Commit,
  Finding,
  type GuidanceRef,
  type Intent,
  type ModelError,
  type ModelUsage,
  type PreferenceKind,
  type StepDraft,
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
  /** Code outside the PR that uses what it changes; empty when no checkout was read. */
  readonly unchangedCallers: readonly InputUnchangedCallers[];
  readonly guidance: InputGuidance;
}

/** The uses outside the PR of one definition the PR changes. */
export interface InputUnchangedCallers {
  readonly symbol: string;
  /** The hunk that changes the definition. */
  readonly hunkId: HunkId;
  readonly uses: readonly UnchangedUse[];
  /** How many more uses there are than `uses` holds. */
  readonly more: number;
}

/**
 * What the reviewer wants the passes to look for and leave out, and the repository's guideline
 * files, each by the ref a finding marks it with. Both empty when there's none.
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
  /**
   * The run asked for the tour. Every pass of such a run answers through the schema that has the
   * steps pass's variant too, so that they share one cache; a run without the tour sends the two.
   */
  readonly tour?: boolean;
}

// Output schemas of the passes whose shape isn't a domain type as is. Model output is untrusted
// input: the adapter parses it with these before returning it.

/** A finding as the model writes it; the server numbers them, and the guardrail call marks them. */
export const FindingDraft = Finding.unwrap().omit({ id: true, guardrail: true }).readonly();
export type FindingDraft = z.infer<typeof FindingDraft>;

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
  /** The page's tour, in call order; only a run that asks for the tour calls it. */
  steps(
    input: AnalysisInput,
    options?: PassOptions,
  ): Promise<Result<PassOutput<StepDraft[]>, ModelError>>;
}
