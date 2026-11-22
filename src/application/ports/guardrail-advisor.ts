import { z } from "zod";
import {
  type CheckConfig,
  GuardrailTool,
  type ModelError,
  type ModelUsage,
  type RepoRef,
} from "../../domain/review/index.ts";
import type { Result } from "../../domain/shared/index.ts";

/** A finding or a risk of the run, as the guardrail call reads it. */
export interface AdvicePoint {
  /** "f1" for a finding, "r1" for the first risk. */
  readonly ref: string;
  readonly kind: "finding" | "risk";
  readonly path: string;
  /** A finding's title; empty for a risk. */
  readonly title: string;
  /** A finding's explanation or a risk's reason. */
  readonly text: string;
  /** The lines it rests on as its hunk shows them, at most 40, the rest counted in one line. */
  readonly code: readonly string[];
}

export interface AdviceInput {
  readonly repo: RepoRef;
  readonly points: readonly AdvicePoint[];
  /** The repository's check configs at the pull request's base commit. */
  readonly configs: readonly CheckConfig[];
  /** Its build files at that commit, to prefer an engine it already uses. */
  readonly buildFiles: readonly { readonly path: string; readonly content: string }[];
}

/**
 * The model's answer, untrusted and loose on purpose: the use case checks every mark and
 * guardrail. A point without a mark has no guardrail; a tool the schema doesn't know is none.
 */
export const AdviceDraft = z
  .object({
    marks: z
      .array(
        z
          .object({
            point: z.string(),
            guardrail: z
              .object({
                kind: z.string(),
                tool: GuardrailTool.nullable().catch(null),
                engine: z.string(),
                rule: z.string().nullable(),
                on: z.boolean(),
                does: z.string(),
              })
              .readonly(),
          })
          .readonly(),
      )
      .readonly(),
  })
  .readonly();
export type AdviceDraft = z.infer<typeof AdviceDraft>;

export interface AdviceOutput {
  readonly value: AdviceDraft;
  /** As a pass's usage, without its name: the run names it. */
  readonly usage: Omit<ModelUsage, "pass">;
}

/** The guardrail call: which of a run's findings and risks a check could catch, and the check. */
export interface GuardrailAdvisor {
  advise(input: AdviceInput): Promise<Result<AdviceOutput, ModelError>>;
}
