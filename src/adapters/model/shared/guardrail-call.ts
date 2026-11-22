import { z } from "zod";
import { AdviceDraft, type GuardrailAdvisor } from "../../../application/ports/index.ts";
import type { ModelError } from "../../../domain/review/index.ts";
import { err, ok, type Result } from "../../../domain/shared/index.ts";
import type { Effort } from "./effort.ts";
import { invalidOutput, modelError } from "./errors.ts";
import { callOn, type OneCall, type RunOneCall } from "./one-call.ts";
import { toStrictJsonSchema } from "./output-schema.ts";
import { GUARDRAILS_SYSTEM_PROMPT, guardrailMessage } from "./prompts/guardrails.ts";

/** The guardrail call's own answer, as the suggestion call has its own. */
export const GUARDRAIL_ANSWER_FORMAT = {
  type: "json_schema",
  schema: toStrictJsonSchema(AdviceDraft),
} as const;

export const GUARDRAIL_EFFORT: Effort = "medium";

export const parseGuardrailAnswer = (json: unknown): Result<AdviceDraft, ModelError> => {
  const answer = AdviceDraft.safeParse(json);
  return answer.success ? ok(answer.data) : err(invalidOutput(z.prettifyError(answer.error)));
};

/** A transport's error in the call's words, where its own speak of a pull request's pass. */
export const guardrailCallError = (error: ModelError): ModelError => {
  switch (error.kind) {
    case "too-large":
      return modelError(
        "too-large",
        "The review's points and the repository's configs are too long for the model's context window.",
      );
    case "refusal":
      return modelError("refusal", "The model declined to say which points a check could catch.");
    default:
      return modelError(
        error.kind,
        error.message.replace(/\b([Tt])he pass\b/g, "$1he guardrail call"),
      );
  }
};

export const GUARDRAIL_CALL: OneCall<AdviceDraft> = {
  name: "guardrails",
  systemPrompt: GUARDRAILS_SYSTEM_PROMPT,
  format: GUARDRAIL_ANSWER_FORMAT,
  effort: GUARDRAIL_EFFORT,
  parse: parseGuardrailAnswer,
  error: guardrailCallError,
  failed: "The guardrail call failed",
  answered: "The guardrail call answered",
};

/** The guardrail call on a transport. */
export const advisorOn = (run: RunOneCall): GuardrailAdvisor => ({
  advise: (input) => callOn(run, GUARDRAIL_CALL, guardrailMessage(input)),
});
