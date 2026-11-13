import type { AnalysisModel, Logger } from "../../application/ports/index.ts";
import type { ModelBilling, ModelError, ModelUsage } from "../../domain/review/index.ts";
import { err, ok } from "../../domain/shared/index.ts";
import { fromClaudeCodeRun, lockdownProblem, notLockedDown } from "./claude-code-errors.ts";
import { parseClaudeCodeStream, parseInit } from "./claude-code-output.ts";
import { claudeCodeRequest, claudeCodeSystemPrompt } from "./claude-code-request.ts";
import { tooLarge } from "./errors.ts";
import { createPassModel } from "./pass-model.ts";
import { passMessage } from "./prompts/passes.ts";
import { renderInput } from "./render-input.ts";
import { MAX_INPUT_TOKENS } from "./request.ts";
import { createRunClaude, type RunClaude } from "./run-claude.ts";
import { CLAUDE_CODE_VERSION } from "./version.ts";

export interface ClaudeCodeAnalysisModelOptions {
  /** Default: the `claude` on the PATH. */
  readonly run?: RunClaude;
  /** "plan" when Claude Code is signed in to a Claude plan, which its status says. */
  readonly billing: ModelBilling;
  readonly maxInputTokens?: number;
  readonly logger: Logger;
}

/**
 * Claude Code has no token count, so the size is estimated from the prompt's UTF-8 bytes. On the
 * eval cases (`node evals/calibrate-claude-code.ts`) a prompt was about 1,550 tokens of Claude
 * Code's own, mostly the answer's schema as a tool, plus a token per 2.06 bytes; these round
 * both toward more tokens. Claude Code's own "prompt is too long" is the backstop.
 */
export const BYTES_PER_TOKEN = 1.9;
export const OVERHEAD_TOKENS = 2_000;

export const estimateTokens = (prompt: string): number =>
  OVERHEAD_TOKENS + Math.ceil(Buffer.byteLength(prompt, "utf8") / BYTES_PER_TOKEN);

/**
 * The four passes through the reviewer's own Claude Code, one `claude -p` process each. The PR
 * data is in the system prompt, the one place Claude Code caches across processes.
 */
export const createClaudeCodeAnalysisModel = (
  options: ClaudeCodeAnalysisModelOptions,
): AnalysisModel => {
  const run = options.run ?? createRunClaude();
  const maxInputTokens = options.maxInputTokens ?? MAX_INPUT_TOKENS;
  const { logger, billing } = options;

  return createPassModel({
    version: CLAUDE_CODE_VERSION,

    async checkSize(input) {
      const inputTokens = estimateTokens(
        claudeCodeSystemPrompt(renderInput(input)) + passMessage("intent", null, undefined),
      );
      logger.debug("Estimated the input", { inputTokens, maxInputTokens });
      return inputTokens > maxInputTokens
        ? err(tooLarge(inputTokens, maxInputTokens))
        : ok({ inputTokens });
    },

    async runPass(pass, input, earlier, passOptions) {
      const request = claudeCodeRequest(
        pass,
        renderInput(input),
        passMessage(pass, earlier, passOptions?.feedback),
      );
      logger.debug("Model pass started", {
        pass,
        transport: "claude-code",
        attempt: passOptions?.feedback ? "retry" : "first",
      });

      let lockdown: string | null = null;
      let checked = false;
      const ran = await run(request.args, {
        stdin: request.stdin,
        files: request.files,
        onLine(line) {
          if (checked) return "continue";
          const init = parseInit(line);
          if (init === null) return "continue";
          checked = true;
          lockdown = lockdownProblem(init, billing === "plan");
          return lockdown === null ? "continue" : "stop";
        },
      });

      const fail = (error: ModelError) => {
        logger.warn("Model pass failed", { pass, kind: error.kind, message: error.message });
        return err(error);
      };
      if (lockdown !== null) return fail(notLockedDown(lockdown));
      const stream = parseClaudeCodeStream(ran.lines);
      const failure = fromClaudeCodeRun(ran, stream);
      if (failure !== null) return fail(failure);
      // A run with an answer but no init event was never checked for tools.
      if (stream.init === null || stream.result === null) {
        return fail(notLockedDown("it reported no session"));
      }

      const { result } = stream;
      const usage: ModelUsage = {
        pass,
        inputTokens: result.inputTokens,
        cacheReadTokens: result.cacheReadTokens,
        cacheWriteTokens: result.cacheWriteTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
        billing,
      };
      logger.info("Model pass finished", {
        ...usage,
        transport: "claude-code",
        claudeCode: stream.init.version,
        stopReason: result.stopReason,
      });
      return ok({ answer: result.structuredOutput, usage });
    },
  });
};
