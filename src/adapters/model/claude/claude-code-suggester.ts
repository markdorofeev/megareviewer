import type { Logger, PreferenceSuggester } from "../../../application/ports/index.ts";
import type { ModelBilling } from "../../../domain/review/index.ts";
import { err, ok } from "../../../domain/shared/index.ts";
import { SUGGEST_SYSTEM_PROMPT, suggestMessage } from "../shared/prompts/suggest.ts";
import {
  parseSuggestion,
  SUGGESTION_ANSWER_FORMAT,
  SUGGESTION_EFFORT,
  suggestionError,
} from "../shared/suggestion.ts";
import { runStructuredCall } from "./claude-code-call.ts";
import type { StructuredCall } from "./claude-code-request.ts";
import { readManagedMcpServers } from "./managed-mcp.ts";
import { claudeModel, effortFor } from "./models.ts";
import { MODEL } from "./request.ts";
import { createRunClaude, type RunClaude } from "./run-claude.ts";

export interface ClaudeCodeSuggesterOptions {
  /** Default: the `claude` on the PATH. */
  readonly run?: RunClaude;
  /** "plan" when Claude Code is signed in to a Claude plan, which its status says. */
  readonly billing: ModelBilling;
  /** Default: MODEL. */
  readonly model?: string;
  readonly logger: Logger;
  /** Default: read from the organization's `managed-mcp.json`, when there is one. */
  readonly managedMcpServers?: readonly string[] | null;
}

/** The suggestion call as one locked-down `claude -p`, as a pass is, with the history on stdin. */
export const suggestionCall = (message: string, model: string = MODEL): StructuredCall => ({
  model,
  effort: effortFor(claudeModel(model), SUGGESTION_EFFORT),
  systemPrompt: SUGGEST_SYSTEM_PROMPT,
  schema: SUGGESTION_ANSWER_FORMAT.schema,
  message,
});

/** The suggestion call through the reviewer's own Claude Code, on its plan when signed in to one. */
export const createClaudeCodeSuggester = (
  options: ClaudeCodeSuggesterOptions,
): PreferenceSuggester => {
  const run = options.run ?? createRunClaude();
  const { logger, billing } = options;
  const model = options.model ?? MODEL;
  const managedMcpServers =
    options.managedMcpServers === undefined ? readManagedMcpServers() : options.managedMcpServers;

  return {
    async suggest(input) {
      const called = await runStructuredCall(run, {
        ...suggestionCall(suggestMessage(input), model),
        managedMcpServers,
        onPlan: billing === "plan",
      });
      if (!called.ok) {
        const failure = suggestionError(called.error);
        logger.warn("Suggesting preferences failed", { transport: "claude-code", ...failure });
        return err(failure);
      }

      const { result, version } = called.value;
      const usage = {
        inputTokens: result.inputTokens,
        cacheReadTokens: result.cacheReadTokens,
        cacheWriteTokens: result.cacheWriteTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
        billing,
      };
      logger.info("Preferences suggested by the model", {
        ...usage,
        transport: "claude-code",
        claudeCode: version,
      });
      const drafts = parseSuggestion(called.value.answer);
      return drafts.ok ? ok({ value: drafts.value, usage }) : drafts;
    },
  };
};
