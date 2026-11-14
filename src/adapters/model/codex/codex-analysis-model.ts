import type { AnalysisModel, Logger } from "../../../application/ports/index.ts";
import type { ModelBilling, ModelError, ModelUsage } from "../../../domain/review/index.ts";
import { err, ok, type Result } from "../../../domain/shared/index.ts";
import type { Effort } from "../shared/effort.ts";
import { invalidOutput, tooLarge } from "../shared/errors.ts";
import { createPassModel } from "../shared/pass-model.ts";
import { passMessage } from "../shared/prompts/passes.ts";
import { renderInput } from "../shared/render-input.ts";
import { fromCodexRun, usedTool } from "./codex-errors.ts";
import { type CodexUsage, parseCodexStream, toolOf } from "./codex-output.ts";
import { type CodexRequest, codexInstructions, codexRequest } from "./codex-request.ts";
import { codexCostUsd, codexModel } from "./models.ts";
import { createRunCodex, type RunCodex } from "./run-codex.ts";
import { codexVersion } from "./version.ts";

/**
 * Codex reports no count before the call, so the size is estimated from the prompt's UTF-8
 * bytes, high on purpose. A call with a few hundred bytes of ours was about 5,300 tokens of Codex's
 * own, its tools and developer text; on the eval cases (`node evals/calibrate-codex.ts`) the rest
 * was a token per 3.36 to 5.19 bytes.
 */
export const BYTES_PER_TOKEN = 3.0;
export const OVERHEAD_TOKENS = 6_000;

/** Every listed model has 272K tokens; the rest is room for the answer and Codex's turn. */
export const DEFAULT_CONTEXT_WINDOW = 272_000;
const ANSWER_ROOM_TOKENS = 32_000;

export const estimateTokens = (prompt: string): number =>
  OVERHEAD_TOKENS + Math.ceil(Buffer.byteLength(prompt, "utf8") / BYTES_PER_TOKEN);

export interface CodexAnalysisModelOptions {
  /** Default: the `codex` on the PATH. */
  readonly run?: RunCodex;
  /** "plan" when Codex is signed in with ChatGPT, which its status says. */
  readonly billing: ModelBilling;
  /** Codex's slug, "gpt-6-luna". */
  readonly model: string;
  /** From Codex's catalog: the model's context window and the efforts it accepts. */
  readonly contextWindow?: number | null;
  readonly efforts?: readonly string[];
  /** Default: each pass's own. One for every pass, only to measure it. */
  readonly effort?: Effort;
  readonly logger: Logger;
}

export interface CodexAnswer {
  /** Parsed from the last message; still untrusted. */
  readonly answer: unknown;
  readonly usage: CodexUsage;
}

/**
 * Runs one request through Codex. The stream is read as it comes, and the first item that shows a
 * tool kills the process: the answer of a session that used one is never read, so whatever a tool
 * read can't reach the page.
 */
export const runCodexCall = async (
  run: RunCodex,
  request: CodexRequest,
): Promise<Result<CodexAnswer, ModelError>> => {
  let tool: string | null = null;
  const ran = await run(request.args, {
    stdin: request.stdin,
    files: request.files,
    dirs: request.dirs,
    onLine(line) {
      tool = toolOf(line);
      return tool === null ? "continue" : "stop";
    },
  });
  if (tool !== null) return err(usedTool(tool));

  const stream = parseCodexStream(ran.lines);
  // Only the lines that were read are checked; the runner stops reading at the first tool.
  if (stream.tools.length > 0) return err(usedTool(stream.tools.join(", ")));
  const failure = fromCodexRun(ran, stream);
  if (failure !== null) return err(failure);
  if (stream.message === null || stream.usage === null) {
    return err(invalidOutput("Codex ended the turn without an answer"));
  }
  try {
    return ok({ answer: JSON.parse(stream.message), usage: stream.usage });
  } catch {
    return err(invalidOutput("the answer isn't JSON"));
  }
};

/** The five passes through the reviewer's own Codex, one `codex exec` process each. */
export const createCodexAnalysisModel = (options: CodexAnalysisModelOptions): AnalysisModel => {
  const run = options.run ?? createRunCodex();
  const { logger, billing, model, effort } = options;
  const maxInputTokens = (options.contextWindow ?? DEFAULT_CONTEXT_WINDOW) - ANSWER_ROOM_TOKENS;
  const price = codexModel(model)?.price ?? null;

  return createPassModel({
    version: codexVersion(model, effort),

    async checkSize(input) {
      const inputTokens = estimateTokens(
        codexInstructions(renderInput(input)) + passMessage("intent", null, undefined),
      );
      logger.debug("Estimated the input", { inputTokens, maxInputTokens });
      return inputTokens > maxInputTokens
        ? err(tooLarge(inputTokens, maxInputTokens))
        : ok({ inputTokens });
    },

    async runPass(pass, input, earlier, passOptions) {
      const request = codexRequest(
        pass,
        renderInput(input),
        passMessage(pass, earlier, passOptions?.feedback),
        model,
        {
          ...(options.efforts === undefined ? {} : { efforts: options.efforts }),
          ...(effort === undefined ? {} : { effort }),
        },
      );
      logger.debug("Model pass started", {
        pass,
        transport: "codex",
        attempt: passOptions?.feedback ? "retry" : "first",
      });

      const called = await runCodexCall(run, request);
      if (!called.ok) {
        logger.warn("Model pass failed", {
          pass,
          kind: called.error.kind,
          message: called.error.message,
        });
        return err(called.error);
      }

      const usage: ModelUsage = {
        pass,
        ...called.value.usage,
        costUsd: codexCostUsd(price, called.value.usage),
        billing,
      };
      logger.info("Model pass finished", { ...usage, transport: "codex", model });
      return ok({ answer: called.value.answer, usage });
    },
  });
};
