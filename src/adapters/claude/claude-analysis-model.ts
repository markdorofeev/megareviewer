import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type {
  AnalysisInput,
  AnalysisModel,
  Logger,
  PassOptions,
  PassOutput,
} from "../../application/ports/index.ts";
import type { ModelError, ModelPass, ModelUsage } from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import { fromSdkError, invalidOutput, maxTokens, refusal, tooLarge } from "./errors.ts";
import { PassAnswer } from "./output-schema.ts";
import { costUsd, HIGHEST_PRICE, PRICES, type TokenCounts } from "./pricing.ts";
import { type EarlierResults, passMessage } from "./prompts/passes.ts";
import { renderInput } from "./render-input.ts";
import { countTokensRequest, MAX_TOKENS, passRequest } from "./request.ts";
import { VERSION } from "./version.ts";

export interface ClaudeAnalysisModelOptions {
  /** Default: new Anthropic(), which resolves ANTHROPIC_API_KEY or an `ant auth login` profile. */
  readonly client?: Anthropic;
  /** Default: 400,000. */
  readonly maxInputTokens?: number;
  readonly logger: Logger;
}

type Answer = PassAnswer["answer"];
type Message = Anthropic.Beta.Messages.BetaMessage;

const tokenCounts = ({ usage }: Message): TokenCounts => ({
  inputTokens: usage.input_tokens,
  cacheReadTokens: usage.cache_read_input_tokens ?? 0,
  cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  outputTokens: usage.output_tokens,
});

const answerText = (message: Message): string =>
  message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");

const parseAnswer = (text: string): Result<Answer, ModelError> => {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return err(invalidOutput("the answer isn't JSON"));
  }
  const answer = PassAnswer.safeParse(json);
  return answer.success
    ? ok(answer.data.answer)
    : err(invalidOutput(z.prettifyError(answer.error)));
};

/** The four passes on Claude, with the PR data shared through the prompt cache. */
export const createClaudeAnalysisModel = (options: ClaudeAnalysisModelOptions): AnalysisModel => {
  const client = options.client ?? new Anthropic();
  const maxInputTokens = options.maxInputTokens ?? 400_000;
  const { logger } = options;

  const usageOf = (pass: ModelPass, message: Message): ModelUsage => {
    const price = PRICES[message.model];
    if (price === undefined) {
      logger.warn("No price for model, using the highest known", { model: message.model });
    }
    const tokens = tokenCounts(message);
    return { pass, ...tokens, costUsd: costUsd(price ?? HIGHEST_PRICE, tokens) };
  };

  const runPass = async <T>(
    pass: ModelPass,
    input: AnalysisInput,
    earlier: EarlierResults | null,
    passOptions: PassOptions | undefined,
    pick: (answer: Answer) => T | null,
  ): Promise<Result<PassOutput<T>, ModelError>> => {
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

    const answer = parseAnswer(answerText(message));
    if (!answer.ok) return answer;
    const value = pick(answer.value);
    if (value === null) {
      return err(invalidOutput(`answered the ${answer.value.pass} task instead of ${pass}`));
    }
    return ok({ value, usage });
  };

  return {
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

    intent: (input, passOptions) =>
      runPass("intent", input, null, passOptions, (answer) =>
        answer.pass === "intent" ? answer.intent : null,
      ),

    risk: (input, intent, passOptions) =>
      runPass("risk", input, { intent }, passOptions, (answer) =>
        answer.pass === "risk" ? answer.assessments : null,
      ),

    decisions: (input, intent, passOptions) =>
      runPass("decisions", input, { intent }, passOptions, (answer) =>
        answer.pass === "decisions" ? answer.decisions : null,
      ),

    tour: (input, intent, risk, decisions, passOptions) =>
      runPass("tour", input, { intent, risk, decisions }, passOptions, (answer) =>
        answer.pass === "tour" ? answer.tour : null,
      ),
  };
};
