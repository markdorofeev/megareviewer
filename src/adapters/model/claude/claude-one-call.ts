import Anthropic from "@anthropic-ai/sdk";
import type {
  GuardrailAdvisor,
  Logger,
  PreferenceSuggester,
} from "../../../application/ports/index.ts";
import { err, ok } from "../../../domain/shared/index.ts";
import { invalidOutput, maxTokens, refusal } from "../shared/errors.ts";
import { advisorOn } from "../shared/guardrail-call.ts";
import type { RunOneCall } from "../shared/one-call.ts";
import { suggesterOn } from "../shared/suggestion.ts";
import { fromSdkError } from "./errors.ts";
import { answerText, apiUsage, type Message } from "./message.ts";
import { apiLimits, MODEL, oneCallRequest } from "./request.ts";

export interface ClaudeOneCallOptions {
  /** Default: new Anthropic(), which resolves ANTHROPIC_API_KEY or an `ant auth login` profile. */
  readonly client?: Anthropic;
  /** Default: MODEL. */
  readonly model?: string;
  readonly logger: Logger;
}

/** Calls of their own on the Anthropic API: one request each with no tools, billed to the account. */
export const createClaudeOneCall = (options: ClaudeOneCallOptions): RunOneCall => {
  const client = options.client ?? new Anthropic();
  const model = options.model ?? MODEL;
  const { logger } = options;

  return async (call, text) => {
    let message: Message;
    try {
      message = await client.beta.messages.stream(oneCallRequest(call, text, model)).finalMessage();
    } catch (error) {
      const failure = call.error(fromSdkError(error));
      logger.warn(call.failed, { ...failure });
      return err(failure);
    }

    const usage = apiUsage(message, logger);
    logger.info(call.answered, {
      ...usage,
      model: message.model,
      stopReason: message.stop_reason,
    });

    if (message.stop_reason === "refusal") return err(call.error(refusal(null)));
    if (message.stop_reason === "max_tokens") return err(maxTokens(apiLimits(model).maxTokens));

    try {
      return ok({ answer: JSON.parse(answerText(message)), usage });
    } catch {
      return err(invalidOutput("the answer isn't JSON"));
    }
  };
};

/** The suggestion call on the Anthropic API. */
export const createClaudeSuggester = (options: ClaudeOneCallOptions): PreferenceSuggester =>
  suggesterOn(createClaudeOneCall(options));

/** The guardrail call on the Anthropic API. */
export const createClaudeAdvisor = (options: ClaudeOneCallOptions): GuardrailAdvisor =>
  advisorOn(createClaudeOneCall(options));
