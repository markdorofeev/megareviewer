import type {
  GuardrailAdvisor,
  Logger,
  PreferenceSuggester,
} from "../../../application/ports/index.ts";
import { err, ok } from "../../../domain/shared/index.ts";
import { advisorOn } from "../shared/guardrail-call.ts";
import type { OneCallAnswer, RunOneCall } from "../shared/one-call.ts";
import { suggesterOn } from "../shared/suggestion.ts";
import { runOpencodeCall } from "./opencode-analysis-model.ts";
import type { OpencodeClient } from "./opencode-client.ts";
import { opencodeOneCallRequest } from "./opencode-request.ts";

export interface OpencodeOneCallOptions {
  readonly client: OpencodeClient;
  readonly providerID: string;
  readonly model: string;
  /** From opencode's model list. */
  readonly variants?: readonly string[];
  /** Whether opencode prices the model; without, its cost is unknown, not zero. */
  readonly priced: boolean;
  readonly timeoutMs?: number;
  readonly logger: Logger;
}

/**
 * Calls of their own through the reviewer's opencode: a session each as the call's agent, whose
 * permissions deny every tool, checked and deleted as a pass's is.
 */
export const createOpencodeOneCall = (options: OpencodeOneCallOptions): RunOneCall => {
  const { client, logger, providerID, model } = options;

  return async (call, message) => {
    const called = await runOpencodeCall(
      client,
      opencodeOneCallRequest(call, message, { providerID, id: model }, options.variants),
      options.timeoutMs,
    );
    if (!called.ok) {
      const failure = call.error(called.error);
      logger.warn(call.failed, { transport: "opencode", ...failure });
      return err(failure);
    }

    const usage: OneCallAnswer["usage"] = {
      ...called.value.tokens,
      costUsd: options.priced ? called.value.costUsd : null,
      billing: "api",
    };
    logger.info(call.answered, { ...usage, transport: "opencode", providerID, model });
    return ok({ answer: called.value.answer, usage });
  };
};

/** The suggestion call through opencode. */
export const createOpencodeSuggester = (options: OpencodeOneCallOptions): PreferenceSuggester =>
  suggesterOn(createOpencodeOneCall(options));

/** The guardrail call through opencode. */
export const createOpencodeAdvisor = (options: OpencodeOneCallOptions): GuardrailAdvisor =>
  advisorOn(createOpencodeOneCall(options));
