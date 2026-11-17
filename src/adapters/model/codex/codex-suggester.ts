import type { Logger, PreferenceSuggester } from "../../../application/ports/index.ts";
import type { ModelBilling } from "../../../domain/review/index.ts";
import { err, ok } from "../../../domain/shared/index.ts";
import { suggestMessage } from "../shared/prompts/suggest.ts";
import { parseSuggestion, suggestionError } from "../shared/suggestion.ts";
import { runCodexCall } from "./codex-analysis-model.ts";
import { codexSuggestionRequest } from "./codex-request.ts";
import { codexCostUsd, codexModel } from "./models.ts";
import { createRunCodex, type RunCodex } from "./run-codex.ts";

export interface CodexSuggesterOptions {
  /** Default: the `codex` on the PATH. */
  readonly run?: RunCodex;
  /** "plan" when Codex is signed in with ChatGPT, which its status says. */
  readonly billing: ModelBilling;
  /** Codex's slug, "gpt-6-luna". */
  readonly model: string;
  /** From Codex's catalog: the efforts the model accepts. */
  readonly efforts?: readonly string[];
  readonly logger: Logger;
}

/** The suggestion call through the reviewer's own Codex: one `codex exec`, watched as a pass is. */
export const createCodexSuggester = (options: CodexSuggesterOptions): PreferenceSuggester => {
  const run = options.run ?? createRunCodex();
  const { logger, billing, model } = options;
  const price = codexModel(model)?.price ?? null;

  return {
    async suggest(input) {
      const called = await runCodexCall(
        run,
        codexSuggestionRequest(suggestMessage(input), model, options.efforts),
      );
      if (!called.ok) {
        const failure = suggestionError(called.error);
        logger.warn("Suggesting preferences failed", { transport: "codex", ...failure });
        return err(failure);
      }

      const usage = {
        ...called.value.usage,
        costUsd: codexCostUsd(price, called.value.usage),
        billing,
      };
      logger.info("Preferences suggested by the model", { ...usage, transport: "codex", model });
      const drafts = parseSuggestion(called.value.answer);
      return drafts.ok ? ok({ value: drafts.value, usage }) : drafts;
    },
  };
};
