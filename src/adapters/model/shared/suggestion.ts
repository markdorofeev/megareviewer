import { z } from "zod";
import { ProposalDraft } from "../../../application/ports/index.ts";
import type { ModelError } from "../../../domain/review/index.ts";
import { err, ok, type Result } from "../../../domain/shared/index.ts";
import type { Effort } from "./effort.ts";
import { invalidOutput, modelError } from "./errors.ts";
import { toStrictJsonSchema } from "./output-schema.ts";

/**
 * The suggestion call's own answer, apart from the passes' union: it shares no cache with them,
 * and the union is near what a provider's grammar takes.
 */
export const SuggestionAnswer = z.object({ proposals: z.array(ProposalDraft) });
export type SuggestionAnswer = z.infer<typeof SuggestionAnswer>;

export const SUGGESTION_ANSWER_FORMAT = {
  type: "json_schema",
  schema: toStrictJsonSchema(SuggestionAnswer),
} as const;

export const SUGGESTION_EFFORT: Effort = "medium";

export const parseSuggestion = (json: unknown): Result<readonly ProposalDraft[], ModelError> => {
  const answer = SuggestionAnswer.safeParse(json);
  return answer.success
    ? ok(answer.data.proposals)
    : err(invalidOutput(z.prettifyError(answer.error)));
};

/** A transport's error in the suggestion's words, where its own speak of a pull request's pass. */
export const suggestionError = (error: ModelError): ModelError => {
  switch (error.kind) {
    case "too-large":
      return modelError(
        "too-large",
        "Your reviews are too long for the model's context window to suggest preferences from.",
      );
    case "refusal":
      return modelError("refusal", "The model declined to suggest preferences.");
    default:
      return modelError(error.kind, error.message.replace(/\b([Tt])he pass\b/g, "$1he suggestion"));
  }
};
