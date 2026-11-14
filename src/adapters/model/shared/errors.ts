import type { ModelError, ModelErrorKind } from "../../../domain/review/index.ts";

export const modelError = (kind: ModelErrorKind, message: string): ModelError => ({
  kind,
  message,
});

export const refusal = (category: string | null): ModelError =>
  modelError(
    "refusal",
    category === null
      ? "The model declined to analyze this pull request."
      : `The model declined to analyze this pull request (category: ${category}).`,
  );

export const maxTokens = (limit: number): ModelError =>
  modelError("max-tokens", `The answer was cut off at the ${limit}-token output limit.`);

export const invalidOutput = (problem: string): ModelError =>
  modelError("invalid-output", `The model's answer doesn't match the schema: ${problem}`);

export const tooLarge = (inputTokens: number, limit: number): ModelError =>
  modelError(
    "too-large",
    `The pull request is ~${inputTokens} tokens, over the limit of ${limit}.`,
  );
