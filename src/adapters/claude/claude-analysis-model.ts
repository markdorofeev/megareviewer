import Anthropic from "@anthropic-ai/sdk";
import type { AnalysisModel, Logger } from "../../application/ports/index.ts";
import type { ModelPass, ModelUsage } from "../../domain/review/index.ts";
import { err, ok } from "../../domain/shared/index.ts";
import { fromSdkError, invalidOutput, maxTokens, refusal, tooLarge } from "./errors.ts";
import { createPassModel } from "./pass-model.ts";
import { costUsd, HIGHEST_PRICE, PRICES, type TokenCounts } from "./pricing.ts";
import { passMessage } from "./prompts/passes.ts";
import { renderInput } from "./render-input.ts";
import { countTokensRequest, MAX_INPUT_TOKENS, MAX_TOKENS, passRequest } from "./request.ts";
import { VERSION } from "./version.ts";

export interface ClaudeAnalysisModelOptions {
  /** Default: new Anthropic(), which resolves ANTHROPIC_API_KEY or an `ant auth login` profile. */
  readonly client?: Anthropic;
  readonly maxInputTokens?: number;
  readonly logger: Logger;
}

type Message = Anthropic.Beta.Messages.BetaMessage;

const tokenCounts = ({ usage }: Message): TokenCounts => ({
  inputTokens: usage.input_tokens,
  cacheReadTokens: usage.cache_read_input_tokens ?? 0,
  cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  outputTokens: usage.output_tokens,
});

const answerText = (message: Message): string =>
  message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");

/** The four passes on the Anthropic API, with the PR data shared through the prompt cache. */
export const createClaudeAnalysisModel = (options: ClaudeAnalysisModelOptions): AnalysisModel => {
  const client = options.client ?? new Anthropic();
  const maxInputTokens = options.maxInputTokens ?? MAX_INPUT_TOKENS;
  const { logger } = options;

  const usageOf = (pass: ModelPass, message: Message): ModelUsage => {
    const price = PRICES[message.model];
    if (price === undefined) {
      logger.warn("No price for model, using the highest known", { model: message.model });
    }
    const tokens = tokenCounts(message);
    return { pass, ...tokens, costUsd: costUsd(price ?? HIGHEST_PRICE, tokens), billing: "api" };
  };

  return createPassModel({
    version: VERSION,

    async checkSize(input) {
      const request = passRequest(
        "intent",
        renderInput(input),
        passMessage("intent", null, undefined),
      );
      let inputTokens: number;
      try {
        ({ input_tokens: inputTokens } = await client.beta.messages.countTokens(
          countTokensRequest(request),
        ));
      } catch (error) {
        return err(fromSdkError(error));
      }
      logger.debug("Measured the input", { inputTokens, maxInputTokens });
      return inputTokens > maxInputTokens
        ? err(tooLarge(inputTokens, maxInputTokens))
        : ok({ inputTokens });
    },

    async runPass(pass, input, earlier, passOptions) {
      const request = passRequest(
        pass,
        renderInput(input),
        passMessage(pass, earlier, passOptions?.feedback),
      );
      logger.debug("Model pass started", {
        pass,
        attempt: passOptions?.feedback ? "retry" : "first",
      });

      let message: Message;
      try {
        message = await client.beta.messages.stream(request).finalMessage();
      } catch (error) {
        const modelError = fromSdkError(error);
        logger.warn("Model pass failed", {
          pass,
          kind: modelError.kind,
          message: modelError.message,
        });
        return err(modelError);
      }

      const usage = usageOf(pass, message);
      logger.info("Model pass finished", {
        ...usage,
        model: message.model,
        stopReason: message.stop_reason,
      });

      if (message.stop_reason === "refusal") {
        return err(refusal(message.stop_details?.category ?? null));
      }
      if (message.stop_reason === "max_tokens") return err(maxTokens(MAX_TOKENS));

      let answer: unknown;
      try {
        answer = JSON.parse(answerText(message));
      } catch {
        return err(invalidOutput("the answer isn't JSON"));
      }
      return ok({ answer, usage });
    },
  });
};
