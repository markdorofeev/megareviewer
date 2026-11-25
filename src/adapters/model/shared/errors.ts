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

/** A failure of the reading, after which the pass can be run again without the reader. */
export const readerFailed = (message: string): ModelError => modelError("reader", message);

export const roundsUsedUp = (): ModelError =>
  readerFailed("It used up its rounds of reading before it answered.");

export const readTooMuch = (): ModelError =>
  readerFailed("What it read didn't fit in the model's context window.");
