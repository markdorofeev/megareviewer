import Anthropic from "@anthropic-ai/sdk";
import {
  type AnalysisModel,
  type Logger,
  MAX_READ_ROUNDS,
  type PassError,
} from "../../../application/ports/index.ts";
import type { HarnessRead, ModelError } from "../../../domain/review/index.ts";
import { err, ok, type Result } from "../../../domain/shared/index.ts";
import {
  invalidOutput,
  maxTokens,
  readerFailed,
  readTooMuch,
  refusal,
  roundsUsedUp,
  tooLarge,
} from "../shared/errors.ts";
import { createPassModel } from "../shared/pass-model.ts";
import { answerJson } from "../shared/prompted-answer.ts";
import { passMessage } from "../shared/prompts/passes.ts";
import { renderInput } from "../shared/render-input.ts";
import { fromSdkError, isRefusedRequest } from "./errors.ts";
import {
  type ApiUsage,
  addUsage,
  answerText,
  apiUsage,
  type Message,
  toolUses,
} from "./message.ts";
import { serveRead } from "./read-file.ts";
import {
  afterReading,
  apiLimits,
  countTokensRequest,
  MODEL,
  passRequest,
  type ReadRound,
} from "./request.ts";
import { apiVersion } from "./version.ts";

export interface ClaudeAnalysisModelOptions {
  /** Default: new Anthropic(), which resolves ANTHROPIC_API_KEY or an `ant auth login` profile. */
  readonly client?: Anthropic;
  readonly maxInputTokens?: number;
  /** Default: MODEL. */
  readonly model?: string;
  readonly logger: Logger;
}

/**
 * The five passes on the Anthropic API, with the PR data shared through the prompt cache. A pass
 * with something to read asks for files in rounds, and megareviewer serves them from the run's own.
 */
export const createClaudeAnalysisModel = (options: ClaudeAnalysisModelOptions): AnalysisModel => {
  const client = options.client ?? new Anthropic();
  const model = options.model ?? MODEL;
  const limits = apiLimits(model);
  const maxInputTokens = options.maxInputTokens ?? limits.maxInputTokens;
  const { logger } = options;

  return createPassModel({
    version: apiVersion(model),
    readsHarness: true,

    async checkSize(input) {
      const request = passRequest(
        "intent",
        renderInput(input),
        passMessage("intent", null, undefined, input),
        model,
        input.harness !== null,
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

    async runPass(pass, given, intent, passOptions) {
      const input = passOptions?.withoutReader === true ? { ...given, harness: null } : given;
      const { harness } = input;
      const request = passRequest(
        pass,
        renderInput(input),
        passMessage(pass, intent, passOptions?.feedback, input),
        model,
        harness !== null,
      );
      logger.debug("Model pass started", {
        pass,
        attempt: passOptions?.feedback ? "retry" : "first",
      });

      const rounds: ReadRound[] = [];
      const reads: HarnessRead[] = [];
      const failed = (error: ModelError): Result<never, PassError> =>
        err(reads.length > 0 ? { ...error, reads } : error);

      let total: ApiUsage | null = null;
      for (;;) {
        let message: Message;
        try {
          // The answer's first event comes once the prompt is read, and so cached.
          message = await client.beta.messages
            .stream(afterReading(request, rounds))
            .on("streamEvent", (event) => {
              if (event.type === "message_start" && rounds.length === 0) {
                passOptions?.onAnswering?.();
              }
            })
            .finalMessage();
        } catch (error) {
          const sdkError = fromSdkError(error);
          // The same request without what was read was taken the round before.
          const modelError =
            rounds.length > 0 && isRefusedRequest(error)
              ? readerFailed(`The API refused what it read: ${sdkError.message}`)
              : sdkError;
          logger.warn("Model pass failed", {
            pass,
            kind: modelError.kind,
            message: modelError.message,
          });
          return failed(modelError);
        }

        const used = apiUsage(message, logger);
        total = total === null ? used : addUsage(total, used);
        logger.debug("Model round finished", { pass, round: rounds.length + 1, ...used });

        const reading = harness !== null && message.stop_reason === "tool_use";
        if (reading && rounds.length < MAX_READ_ROUNDS) {
          const served = toolUses(message).map((use) =>
            serveRead(use, harness.contents, rounds.length + 1),
          );
          reads.push(...served.flatMap(({ read }) => (read === null ? [] : [read])));
          rounds.push({ asked: message.content, given: served.map(({ result }) => result) });
          continue;
        }

        const usage = { pass, ...total };
        logger.info("Model pass finished", {
          ...usage,
          model: message.model,
          stopReason: message.stop_reason,
          rounds: rounds.length + 1,
        });

        if (message.stop_reason === "refusal") {
          return failed(refusal(message.stop_details?.category ?? null));
        }
        if (message.stop_reason === "max_tokens") return failed(maxTokens(limits.maxTokens));
        if (reading) return failed(roundsUsedUp());
        if (rounds.length > 0 && message.stop_reason === "model_context_window_exceeded") {
          return failed(readTooMuch());
        }

        const answer = answerJson(answerText(message));
        if (answer === undefined) return failed(invalidOutput("the answer isn't one JSON object"));
        return ok({ answer, usage, ...(reads.length > 0 ? { reads } : {}) });
      }
    },
  });
};
