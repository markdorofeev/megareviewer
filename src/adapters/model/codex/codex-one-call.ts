import type {
  GuardrailAdvisor,
  Logger,
  PreferenceSuggester,
} from "../../../application/ports/index.ts";
import type { ModelBilling } from "../../../domain/review/index.ts";
import { err, ok } from "../../../domain/shared/index.ts";
import { advisorOn } from "../shared/guardrail-call.ts";
import type { RunOneCall } from "../shared/one-call.ts";
import { suggesterOn } from "../shared/suggestion.ts";
import { runCodexCall } from "./codex-analysis-model.ts";
import { codexOneCallRequest } from "./codex-request.ts";
import { codexCostUsd, codexModel } from "./models.ts";
import { createRunCodex, type RunCodex } from "./run-codex.ts";

export interface CodexOneCallOptions {
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

/** Calls of their own through the reviewer's own Codex: one `codex exec` each, watched as a pass is. */
export const createCodexOneCall = (options: CodexOneCallOptions): RunOneCall => {
  const run = options.run ?? createRunCodex();
  const { logger, billing, model } = options;
  const price = codexModel(model)?.price ?? null;

  return async (call, message) => {
    const called = await runCodexCall(
      run,
      codexOneCallRequest(call, message, model, options.efforts),
    );
    if (!called.ok) {
      const failure = call.error(called.error);
      logger.warn(call.failed, { transport: "codex", ...failure });
      return err(failure);
    }

    const usage = {
      ...called.value.usage,
      costUsd: codexCostUsd(price, called.value.usage),
      billing,
    };
    logger.info(call.answered, { ...usage, transport: "codex", model });
    return ok({ answer: called.value.answer, usage });
  };
};

/** The suggestion call through Codex. */
export const createCodexSuggester = (options: CodexOneCallOptions): PreferenceSuggester =>
  suggesterOn(createCodexOneCall(options));

/** The guardrail call through Codex. */
export const createCodexAdvisor = (options: CodexOneCallOptions): GuardrailAdvisor =>
  advisorOn(createCodexOneCall(options));
