import type { ModelError } from "../../../domain/review/index.ts";
import { modelError, refusal } from "../shared/errors.ts";
import { describeHttpError, type OpencodeHttpError } from "./opencode-client.ts";
import type { OpencodeError, OpencodeTurn } from "./opencode-output.ts";

export const NOT_INSTALLED =
  "opencode isn't installed. Install it (https://opencode.ai), connect a provider with `opencode auth login`, then try again.";

/** A tool ran, or was asked for: the answer is discarded. */
export const usedTool = (tools: readonly string[]): ModelError =>
  modelError(
    "unexpected",
    `The session used a tool (${tools.join(", ")}), so the pass was stopped and its answer discarded.`,
  );

/** The server couldn't be reached or started, or answered a request with an error. */
export const fromHttpError = (error: OpencodeHttpError): ModelError => {
  if (error.kind === "server" && error.problem.kind === "not-installed") {
    return modelError("unauthorized", NOT_INSTALLED);
  }
  if (error.kind === "timeout") {
    return modelError("unexpected", "opencode didn't finish the pass in 10 minutes.");
  }
  return modelError("unexpected", describeHttpError(error));
};

const AUTH = /auth|unauthori[sz]ed|api.?key|credential|forbidden/i;
const LIMIT = /rate.?limit|quota|too many requests|usage.?limit/i;
const TOO_LARGE = /context.?(overflow|length|window)|too long|too large|maximum context|input exceeds/i;
const FILTER = /content.?filter|refus|safety/i;
const OVERLOADED = /overload|unavailable|server.?error|internal error/i;
const NETWORK = /transport|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|timed? ?out|connect/i;

/** The provider's own failure, passed through with its message. */
export const fromOpencodeError = (error: OpencodeError): ModelError => {
  const said = `${error.type} ${error.message}`;
  const status = error.status ?? 0;
  if (status === 401 || status === 403 || AUTH.test(error.type)) {
    return modelError(
      "unauthorized",
      `The provider refused opencode's credentials: ${error.message} Check them with \`opencode auth list\`.`,
    );
  }
  if (status === 429 || LIMIT.test(said)) {
    return modelError("rate-limited", `The provider's limit is reached: ${error.message}`);
  }
  if (TOO_LARGE.test(said)) {
    return modelError("too-large", `The pull request is too long for the model: ${error.message}`);
  }
  if (FILTER.test(error.type)) return refusal(null);
  if (status >= 500 || OVERLOADED.test(said)) {
    return modelError("overloaded", `The provider is overloaded or failing: ${error.message}`);
  }
  if (NETWORK.test(error.type)) {
    return modelError("network", `opencode can't reach the provider: ${error.message}`);
  }
  return modelError("unexpected", `opencode failed: ${error.message}`);
};

/**
 * Why a pass failed, or null when the model gave an answer. Nothing is retried here: opencode
 * retries the provider's requests, and the pipeline retries a pass once on an invalid answer.
 */
export const fromTurn = (turn: OpencodeTurn): ModelError | null => {
  if (turn.error !== null) return fromOpencodeError(turn.error);
  if (turn.interrupted) {
    return modelError("unexpected", "opencode didn't finish the pass in 10 minutes.");
  }
  if (turn.finish === "content-filter") return refusal(null);
  if (turn.finish === "length") {
    return modelError("max-tokens", "The answer was cut off at the model's output limit.");
  }
  return null;
};
