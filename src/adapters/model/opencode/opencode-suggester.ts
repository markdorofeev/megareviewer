import type {
  Logger,
  PreferenceSuggester,
  SuggestionOutput,
} from "../../../application/ports/index.ts";
import { err, ok } from "../../../domain/shared/index.ts";
import { suggestMessage } from "../shared/prompts/suggest.ts";
import { parseSuggestion, suggestionError } from "../shared/suggestion.ts";
import { runOpencodeCall } from "./opencode-analysis-model.ts";
import type { OpencodeClient } from "./opencode-client.ts";
import { opencodeSuggestionRequest } from "./opencode-request.ts";

export interface OpencodeSuggesterOptions {
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
 * The suggestion call through the reviewer's opencode: a session of its own as the suggestion
 * agent, whose permissions deny every tool, checked and deleted as a pass's is.
 */
export const createOpencodeSuggester = (options: OpencodeSuggesterOptions): PreferenceSuggester => {
  const { client, logger, providerID, model } = options;

  return {
    async suggest(input) {
      const called = await runOpencodeCall(
        client,
        opencodeSuggestionRequest(
          suggestMessage(input),
          { providerID, id: model },
          options.variants,
        ),
        options.timeoutMs,
      );
      if (!called.ok) {
        const failure = suggestionError(called.error);
        logger.warn("Suggesting preferences failed", { transport: "opencode", ...failure });
        return err(failure);
      }

      const usage: SuggestionOutput["usage"] = {
        ...called.value.tokens,
        costUsd: options.priced ? called.value.costUsd : null,
        billing: "api",
      };
      logger.info("Preferences suggested by the model", {
        ...usage,
        transport: "opencode",
        providerID,
        model,
      });
      const drafts = parseSuggestion(called.value.answer);
      return drafts.ok ? ok({ value: drafts.value, usage }) : drafts;
    },
  };
};
