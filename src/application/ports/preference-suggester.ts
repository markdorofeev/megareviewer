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
  /** What the reviewer did here on `repo`'s pull requests, newest first. */
  readonly signals: readonly ReviewSignal[];
  /** The reviewer's past comments on `repo`'s host, newest first, none a signal already has. */
  readonly comments: readonly PastComment[];
  /** Every preference the reviewer has, so none is proposed again. */
  readonly preferences: readonly Preference[];
  /** Proposals the reviewer rejected, so none is proposed again. */
  readonly rejected: readonly PreferenceProposal[];
  /** The repository every signal and comment is from. */
  readonly repo: RepoRef;
}

/**
 * A preference as the model proposes it. Model output is untrusted input: the adapter parses it
 * with this, and "repo" means the repository the call read.
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

/** One model call that turns review signals and past comments into proposed preferences. */
export interface PreferenceSuggester {
  suggest(input: SuggestionInput): Promise<Result<SuggestionOutput, ModelError>>;
}
