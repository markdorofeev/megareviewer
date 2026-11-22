import Anthropic from "@anthropic-ai/sdk";
import type { AnalysisModel, Logger } from "../../../application/ports/index.ts";
import { err, ok } from "../../../domain/shared/index.ts";
import { invalidOutput, maxTokens, refusal, tooLarge } from "../shared/errors.ts";
import { createPassModel } from "../shared/pass-model.ts";
import { answerJson } from "../shared/prompted-answer.ts";
import { passMessage } from "../shared/prompts/passes.ts";
import { renderInput } from "../shared/render-input.ts";
import { fromSdkError } from "./errors.ts";
import { answerText, apiUsage, type Message } from "./message.ts";
import { apiLimits, countTokensRequest, MODEL, passRequest } from "./request.ts";
import { apiVersion } from "./version.ts";

export interface ClaudeAnalysisModelOptions {
  /** Default: new Anthropic(), which resolves ANTHROPIC_API_KEY or an `ant auth login` profile. */
  readonly client?: Anthropic;
  readonly maxInputTokens?: number;
  /** Default: MODEL. */
  readonly model?: string;
  readonly logger: Logger;
}

/** The four passes on the Anthropic API, with the PR data shared through the prompt cache. */
export const createClaudeAnalysisModel = (options: ClaudeAnalysisModelOptions): AnalysisModel => {
  const client = options.client ?? new Anthropic();
  const model = options.model ?? MODEL;
  const limits = apiLimits(model);
  const maxInputTokens = options.maxInputTokens ?? limits.maxInputTokens;
  const { logger } = options;

  return createPassModel({
    version: apiVersion(model),

    async checkSize(input) {
      const request = passRequest(
        "intent",
        renderInput(input),
        passMessage("intent", null, undefined),
        model,
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

    async runPass(pass, input, intent, passOptions) {
      const request = passRequest(
        pass,
        renderInput(input),
        passMessage(pass, intent, passOptions?.feedback),
        model,
      );
      logger.debug("Model pass started", {
        pass,
        attempt: passOptions?.feedback ? "retry" : "first",
      });

      let message: Message;
      try {
        // The answer's first event comes once the prompt is read, and so cached.
        message = await client.beta.messages
          .stream(request)
          .on("streamEvent", (event) => {
            if (event.type === "message_start") passOptions?.onAnswering?.();
          })
          .finalMessage();
      } catch (error) {
        const modelError = fromSdkError(error);
        logger.warn("Model pass failed", {
          pass,
          kind: modelError.kind,
          message: modelError.message,
        });
        return err(modelError);
      }

      const usage = { pass, ...apiUsage(message, logger) };
      logger.info("Model pass finished", {
        ...usage,
        model: message.model,
        stopReason: message.stop_reason,
      });

      if (message.stop_reason === "refusal") {
        return err(refusal(message.stop_details?.category ?? null));
      }
      if (message.stop_reason === "max_tokens") return err(maxTokens(limits.maxTokens));

      const answer = answerJson(answerText(message));
      if (answer === undefined) return err(invalidOutput("the answer isn't one JSON object"));
      return ok({ answer, usage });
    },
  });
};
