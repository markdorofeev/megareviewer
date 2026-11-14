import { z } from "zod";
import type { AnalysisModel, Logger } from "../../../application/ports/index.ts";
import type { ModelError, ModelUsage } from "../../../domain/review/index.ts";
import { err, ok, type Result } from "../../../domain/shared/index.ts";
import type { Effort } from "../shared/effort.ts";
import { invalidOutput, tooLarge } from "../shared/errors.ts";
import { createPassModel } from "../shared/pass-model.ts";
import { passMessage } from "../shared/prompts/passes.ts";
import { renderInput } from "../shared/render-input.ts";
import type { OpencodeClient } from "./opencode-client.ts";
import { fromHttpError, fromTurn, usedTool } from "./opencode-errors.ts";
import { answerJson, type OpencodeTokens, readTurn } from "./opencode-output.ts";
import { type OpencodeRequest, opencodeRequest, passText, prEntry } from "./opencode-request.ts";
import { opencodeVersion } from "./version.ts";

/**
 * opencode gives no count before the call, and the tokenizer is whichever the model has, so the
 * size is estimated from the prompt's UTF-8 bytes at Claude's rate, the densest measured (2.06
 * bytes a token on the eval cases), high on purpose. opencode's own blocks and its one tool were
 * about 1,000 tokens.
 */
export const BYTES_PER_TOKEN = 1.9;
export const OVERHEAD_TOKENS = 2_000;
/** For a model the list gives no context size for, as for Claude's own transports. */
export const DEFAULT_CONTEXT_TOKENS = 400_000;
const ANSWER_ROOM_TOKENS = 32_000;
const PASS_TIMEOUT_MS = 10 * 60 * 1000;

export const estimateTokens = (prompt: string): number =>
  OVERHEAD_TOKENS + Math.ceil(Buffer.byteLength(prompt, "utf8") / BYTES_PER_TOKEN);

const Created = z.object({ data: z.object({ id: z.string().regex(/^ses/) }).loose() });

export interface OpencodeAnswer {
  /** Parsed from the answer's text; still untrusted. */
  readonly answer: unknown;
  readonly tokens: OpencodeTokens;
  readonly costUsd: number;
}

/**
 * Runs one pass in a session of its own, deleted afterwards so it stays out of the reviewer's
 * opencode history. A session that did anything but answer has its answer discarded: the agent's
 * permissions deny every tool, and this is the check that none ran.
 */
export const runOpencodeCall = async (
  client: OpencodeClient,
  request: OpencodeRequest,
  timeoutMs: number = PASS_TIMEOUT_MS,
): Promise<Result<OpencodeAnswer, ModelError>> => {
  const created = await client.request("POST", "/api/session", { body: request.session });
  if (!created.ok) return err(fromHttpError(created.error));
  const session = Created.safeParse(created.value);
  if (!session.success) {
    return err(fromHttpError({ kind: "status", status: 200, body: "no session ID in its answer" }));
  }
  const id = session.data.data.id;
  try {
    const steps = [
      ...request.entries.map(
        (entry) => () =>
          client.request(
            "PUT",
            `/api/experimental/session/${id}/instructions/entries/${entry.key}`,
            {
              body: { value: entry.value },
            },
          ),
      ),
      () => client.request("POST", `/api/session/${id}/prompt`, { body: { text: request.prompt } }),
    ];
    for (const step of steps) {
      const done = await step();
      if (!done.ok) return err(fromHttpError(done.error));
    }
    const waited = await client.request("POST", `/api/experimental/session/${id}/wait`, {
      body: {},
      timeoutMs,
    });
    if (!waited.ok) {
      await client.request("POST", `/api/session/${id}/interrupt`, { body: {} });
      return err(fromHttpError(waited.error));
    }
    const messages = await client.request("GET", `/api/session/${id}/message`);
    if (!messages.ok) return err(fromHttpError(messages.error));
    const turn = readTurn(messages.value);
    if (turn === null) {
      return err(invalidOutput("opencode returned the session's messages in an unknown shape"));
    }
    if (turn.tools.length > 0) return err(usedTool(turn.tools));
    const failure = fromTurn(turn);
    if (failure !== null) return err(failure);
    if (turn.text === null) return err(invalidOutput("the model ended the turn without an answer"));
    const answer = answerJson(turn.text);
    if (answer === undefined) return err(invalidOutput("the answer isn't one JSON object"));
    return ok({ answer, tokens: turn.tokens, costUsd: turn.costUsd });
  } finally {
    await client.request("DELETE", `/api/session/${id}`);
  }
};

export interface OpencodeAnalysisModelOptions {
  readonly client: OpencodeClient;
  readonly providerID: string;
  readonly model: string;
  /** From opencode's model list. */
  readonly variants?: readonly string[];
  readonly contextTokens?: number | null;
  /** Whether opencode prices the model; without, its cost is unknown, not zero. */
  readonly priced: boolean;
  /** Default: each pass's own. One for every pass, only to measure it. */
  readonly effort?: Effort;
  readonly timeoutMs?: number;
  readonly logger: Logger;
}

/**
 * The four passes through the reviewer's opencode, a session each on one server. opencode answers
 * only once the session is idle, so `onAnswering` is never called: the other passes wait for the
 * intent's end, as on Codex.
 */
export const createOpencodeAnalysisModel = (
  options: OpencodeAnalysisModelOptions,
): AnalysisModel => {
  const { client, logger, providerID, model, effort } = options;
  const maxInputTokens = (options.contextTokens ?? DEFAULT_CONTEXT_TOKENS) - ANSWER_ROOM_TOKENS;
  const ref = { providerID, id: model };

  return createPassModel({
    version: opencodeVersion(providerID, model, effort),

    async checkSize(input) {
      const inputTokens = estimateTokens(
        prEntry(renderInput(input)) + passText("intent", passMessage("intent", null, undefined)),
      );
      logger.debug("Estimated the input", { inputTokens, maxInputTokens });
      return inputTokens > maxInputTokens
        ? err(tooLarge(inputTokens, maxInputTokens))
        : ok({ inputTokens });
    },

    async runPass(pass, input, intent, passOptions) {
      const request = opencodeRequest(
        pass,
        renderInput(input),
        passMessage(pass, intent, passOptions?.feedback),
        ref,
        {
          ...(options.variants === undefined ? {} : { variants: options.variants }),
          ...(effort === undefined ? {} : { effort }),
        },
      );
      logger.debug("Model pass started", {
        pass,
        transport: "opencode",
        attempt: passOptions?.feedback ? "retry" : "first",
      });

      const called = await runOpencodeCall(client, request, options.timeoutMs);
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
        ...called.value.tokens,
        costUsd: options.priced ? called.value.costUsd : null,
        billing: "api",
      };
      logger.info("Model pass finished", { ...usage, transport: "opencode", providerID, model });
      return ok({ answer: called.value.answer, usage });
    },
  });
};
