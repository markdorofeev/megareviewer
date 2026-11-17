import { z } from "zod";
import {
  type ModelError,
  type ModelUsage,
  type PastComment,
  type Preference,
  PreferenceKind,
  type PreferenceProposal,
  type RepoRef,
  type ReviewSignal,
} from "../../domain/review/index.ts";
import type { Result } from "../../domain/shared/index.ts";

export interface SuggestionInput {
  /** What the reviewer did here, newest first; empty when importing. */
  readonly signals: readonly ReviewSignal[];
  /** The reviewer's past comments on `repo`, newest first; empty when suggesting from signals. */
  readonly comments: readonly PastComment[];
  /** Every preference the reviewer has, so none is proposed again. */
  readonly preferences: readonly Preference[];
  /** Proposals the reviewer rejected, so none is proposed again. */
  readonly rejected: readonly PreferenceProposal[];
  /** The repository an import reads; null when suggesting from signals. */
  readonly repo: RepoRef | null;
}

/**
 * A preference as the model proposes it. Model output is untrusted input: the adapter parses it
 * with this, and the use case decides the repository a "repo" scope means, or falls back to global.
 */
export const ProposalDraft = z
  .object({
    kind: PreferenceKind,
    text: z.string(),
    scope: z.enum(["global", "repo"]),
    evidence: z.array(z.string()).readonly(),
  })
  .readonly();
export type ProposalDraft = z.infer<typeof ProposalDraft>;

export interface SuggestionOutput {
  readonly value: readonly ProposalDraft[];
  /** As a pass's usage, without a pass: the call is none of the four. */
  readonly usage: Omit<ModelUsage, "pass">;
}

/** One model call that turns review signals or past comments into proposed preferences. */
export interface PreferenceSuggester {
  suggest(input: SuggestionInput): Promise<Result<SuggestionOutput, ModelError>>;
}
