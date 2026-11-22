import type {
  GuardrailAdvisor,
  Logger,
  PreferenceSuggester,
} from "../../../application/ports/index.ts";
import type { ModelBilling } from "../../../domain/review/index.ts";
import { err, ok } from "../../../domain/shared/index.ts";
import { advisorOn } from "../shared/guardrail-call.ts";
import type { OneCall, RunOneCall } from "../shared/one-call.ts";
import { suggesterOn } from "../shared/suggestion.ts";
import { runStructuredCall } from "./claude-code-call.ts";
import type { StructuredCall } from "./claude-code-request.ts";
import { readManagedMcpServers } from "./managed-mcp.ts";
import { claudeModel, effortFor } from "./models.ts";
import { MODEL } from "./request.ts";
import { createRunClaude, type RunClaude } from "./run-claude.ts";

export interface ClaudeCodeOneCallOptions {
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

/** A call of its own as one locked-down `claude -p`, as a pass is, with its data on stdin. */
export const oneCall = (
  call: OneCall<unknown>,
  message: string,
  model: string = MODEL,
): StructuredCall => ({
  model,
  effort: effortFor(claudeModel(model), call.effort),
  systemPrompt: call.systemPrompt,
  schema: call.format.schema,
  message,
});

/** Calls of their own through the reviewer's own Claude Code, on its plan when signed in to one. */
export const createClaudeCodeOneCall = (options: ClaudeCodeOneCallOptions): RunOneCall => {
  const run = options.run ?? createRunClaude();
  const { logger, billing } = options;
  const model = options.model ?? MODEL;
  const managedMcpServers =
    options.managedMcpServers === undefined ? readManagedMcpServers() : options.managedMcpServers;

  return async (call, message) => {
    const called = await runStructuredCall(run, {
      ...oneCall(call, message, model),
      managedMcpServers,
      onPlan: billing === "plan",
    });
    if (!called.ok) {
      const failure = call.error(called.error);
      logger.warn(call.failed, { transport: "claude-code", ...failure });
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
    logger.info(call.answered, { ...usage, transport: "claude-code", claudeCode: version });
    return ok({ answer: called.value.answer, usage });
  };
};

/** The suggestion call through Claude Code. */
export const createClaudeCodeSuggester = (options: ClaudeCodeOneCallOptions): PreferenceSuggester =>
  suggesterOn(createClaudeCodeOneCall(options));

/** The guardrail call through Claude Code. */
export const createClaudeCodeAdvisor = (options: ClaudeCodeOneCallOptions): GuardrailAdvisor =>
  advisorOn(createClaudeCodeOneCall(options));
