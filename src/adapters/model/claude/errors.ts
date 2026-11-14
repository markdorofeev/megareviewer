import Anthropic from "@anthropic-ai/sdk";
import type { ModelError } from "../../../domain/review/index.ts";
import { modelError } from "../shared/errors.ts";

/**
 * Maps what the SDK throws, after its own retries of 429, 5xx and connection errors, to a
 * ModelError, most specific class first. Anything that isn't an SDK error is a bug and is
 * rethrown.
 */
export const fromSdkError = (error: unknown): ModelError => {
  if (error instanceof Anthropic.AuthenticationError) {
    return modelError(
      "unauthorized",
      "Anthropic rejected the credentials. Set ANTHROPIC_API_KEY or run `ant auth login`.",
    );
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return modelError(
      "unauthorized",
      `The Anthropic credentials can't use this model: ${error.message}`,
    );
  }
  if (error instanceof Anthropic.RateLimitError) {
    return modelError("rate-limited", `Anthropic rate limit reached: ${error.message}`);
  }
  if (error instanceof Anthropic.InternalServerError) {
    return modelError(
      "overloaded",
      `Anthropic is overloaded or failing (${error.status}): ${error.message}`,
    );
  }
  // Includes timeouts, which subclass it.
  if (error instanceof Anthropic.APIConnectionError) {
    return modelError("network", `Can't reach Anthropic: ${error.message}`);
  }
  if (error instanceof Anthropic.APIError) {
    return modelError("unexpected", `Anthropic answered ${error.status}: ${error.message}`);
  }
  // The SDK's own failures, like a stream that ended early.
  if (error instanceof Anthropic.AnthropicError) {
    return modelError("unexpected", error.message);
  }
  throw error;
};
