import Anthropic from "@anthropic-ai/sdk";
import type { Logger, PreferenceSuggester } from "../../../application/ports/index.ts";
import { err, ok } from "../../../domain/shared/index.ts";
import { invalidOutput, maxTokens, refusal } from "../shared/errors.ts";
import { suggestMessage } from "../shared/prompts/suggest.ts";
import { parseSuggestion, suggestionError } from "../shared/suggestion.ts";
import { fromSdkError } from "./errors.ts";
import { answerText, apiUsage, type Message } from "./message.ts";
import { apiLimits, MODEL, suggestionRequest } from "./request.ts";

export interface ClaudeSuggesterOptions {
  /** Default: new Anthropic(), which resolves ANTHROPIC_API_KEY or an `ant auth login` profile. */
  readonly client?: Anthropic;
  /** Default: MODEL. */
  readonly model?: string;
  readonly logger: Logger;
}

/** The suggestion call on the Anthropic API: one request with no tools, billed to the account. */
export const createClaudeSuggester = (options: ClaudeSuggesterOptions): PreferenceSuggester => {
  const client = options.client ?? new Anthropic();
  const model = options.model ?? MODEL;
  const { logger } = options;

  return {
    async suggest(input) {
      let message: Message;
      try {
        message = await client.beta.messages
          .stream(suggestionRequest(suggestMessage(input), model))
          .finalMessage();
      } catch (error) {
        const failure = suggestionError(fromSdkError(error));
        logger.warn("Suggesting preferences failed", { ...failure });
        return err(failure);
      }

      const usage = apiUsage(message, logger);
      logger.info("Preferences suggested by the model", {
        ...usage,
        model: message.model,
        stopReason: message.stop_reason,
      });

      if (message.stop_reason === "refusal") return err(suggestionError(refusal(null)));
      if (message.stop_reason === "max_tokens") return err(maxTokens(apiLimits(model).maxTokens));

      let answer: unknown;
      try {
        answer = JSON.parse(answerText(message));
      } catch {
        return err(invalidOutput("the answer isn't JSON"));
      }
      const drafts = parseSuggestion(answer);
      return drafts.ok ? ok({ value: drafts.value, usage }) : drafts;
    },
  };
};
