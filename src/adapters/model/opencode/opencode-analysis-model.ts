import { z } from "zod";
import {
  type AnalysisModel,
  type InputHarness,
  type Logger,
  MAX_READ_ROUNDS,
  type PassError,
} from "../../../application/ports/index.ts";
import type { HarnessRead, ModelError, ModelUsage } from "../../../domain/review/index.ts";
import { err, ok, type Result } from "../../../domain/shared/index.ts";
import type { Effort } from "../shared/effort.ts";
import { invalidOutput, readerFailed, roundsUsedUp, tooLarge } from "../shared/errors.ts";
import { createPassModel } from "../shared/pass-model.ts";
import { answerJson, passText } from "../shared/prompted-answer.ts";
import { passMessage } from "../shared/prompts/passes.ts";
import { renderInput } from "../shared/render-input.ts";
import { createHarnessDirectories } from "./harness-directory.ts";
import type { OpencodeClient, OpencodeHttpError } from "./opencode-client.ts";
import { fromHttpError, fromTurn, readingFailure, usedTool } from "./opencode-errors.ts";
import {
  type OpencodeTokens,
  type PassHarness,
  readTurn,
  SessionMessages,
} from "./opencode-output.ts";
import { type OpencodeRequest, opencodeRequest, prEntry } from "./opencode-request.ts";
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
/** How often a pass that reads is looked at while it runs, for the rounds it has used. */
const ROUNDS_POLL_MS = 2_000;
/** More than any pass has, so a page that never ends isn't followed forever. */
const MAX_MESSAGE_PAGES = 50;

export const estimateTokens = (prompt: string): number =>
  OVERHEAD_TOKENS + Math.ceil(Buffer.byteLength(prompt, "utf8") / BYTES_PER_TOKEN);

const Created = z.object({ data: z.object({ id: z.string().regex(/^ses/) }).loose() });

export interface OpencodeAnswer {
  /** Parsed from the answer's text; still untrusted. */
  readonly answer: unknown;
  readonly tokens: OpencodeTokens;
  readonly costUsd: number;
  /** What it read of the harness, in order. */
  readonly reads: readonly HarnessRead[];
}

/** A session's messages, oldest first, from every page. */
const messagesOf = async (
  client: OpencodeClient,
  id: string,
): Promise<Result<unknown, OpencodeHttpError>> => {
  const data: unknown[] = [];
  let query = "order=asc&limit=200";
  for (let page = 0; page < MAX_MESSAGE_PAGES; page += 1) {
    const read = await client.request("GET", `/api/session/${id}/message?${query}`);
    if (!read.ok) return read;
    const messages = SessionMessages.safeParse(read.value);
    // The turn's reader says what's wrong with it.
    if (!messages.success) return ok(read.value);
    data.push(...messages.data.data);
    const next = messages.data.cursor?.next;
    if (next == null || messages.data.data.length === 0) return ok({ data });
    query = `cursor=${encodeURIComponent(next)}&limit=200`;
  }
  // Read only in part, a session can't be checked.
  return ok(null);
};

/** Interrupts a pass that asks for more rounds of reading than it has, until it ends. */
const watchRounds = (
  client: OpencodeClient,
  id: string,
  harness: PassHarness,
  pollMs: number,
): { readonly usedUp: () => boolean; readonly stop: () => void } => {
  let usedUp = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const look = async () => {
    const messages = await messagesOf(client, id);
    if (stopped) return;
    const turn = messages.ok ? readTurn(messages.value, harness) : null;
    if (turn !== null && turn.rounds > MAX_READ_ROUNDS) {
      usedUp = true;
      await client.request("POST", `/api/session/${id}/interrupt`, { body: {} });
      return;
    }
    timer = setTimeout(look, pollMs);
  };
  timer = setTimeout(look, pollMs);
  return {
    usedUp: () => usedUp,
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
};

/**
 * Runs one pass in a session of its own, deleted afterwards so it stays out of the reviewer's
 * opencode history. A session that did anything but answer, or with a harness read its files, has
 * its answer discarded: the permissions deny every tool, and this is the check that none ran.
 */
export const runOpencodeCall = async (
  client: OpencodeClient,
  request: OpencodeRequest,
  timeoutMs: number = PASS_TIMEOUT_MS,
  reading: { readonly harness: PassHarness; readonly pollMs?: number } | null = null,
): Promise<Result<OpencodeAnswer, PassError>> => {
  const created = await client.request("POST", "/api/session", { body: request.session });
  if (!created.ok) return err(fromHttpError(created.error));
  const session = Created.safeParse(created.value);
  if (!session.success) {
    return err(fromHttpError({ kind: "status", status: 200, body: "no session ID in its answer" }));
  }
  const id = session.data.data.id;
  const harness = reading?.harness ?? null;
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
    const watch =
      harness === null ? null : watchRounds(client, id, harness, reading?.pollMs ?? ROUNDS_POLL_MS);
    const waited = await client
      .request("POST", `/api/experimental/session/${id}/wait`, { body: {}, timeoutMs })
      .finally(() => watch?.stop());
    if (!waited.ok) {
      await client.request("POST", `/api/session/${id}/interrupt`, { body: {} });
      return err(fromHttpError(waited.error));
    }
    const messages = await messagesOf(client, id);
    if (!messages.ok) return err(fromHttpError(messages.error));
    const turn = readTurn(messages.value, harness);
    if (turn === null) {
      return err(invalidOutput("opencode returned the session's messages in an unknown shape"));
    }
    const failed = (error: ModelError) =>
      err(turn.reads.length === 0 ? error : { ...error, reads: turn.reads });
    if (turn.tools.length > 0) {
      const used = usedTool(turn.tools);
      return failed(harness === null ? used : readerFailed(used.message));
    }
    if (watch?.usedUp()) return failed(roundsUsedUp());
    const failure = fromTurn(turn);
    if (failure !== null) {
      return failed((harness === null ? null : readingFailure(turn, failure)) ?? failure);
    }
    if (turn.text === null) {
      return failed(invalidOutput("the model ended the turn without an answer"));
    }
    const answer = answerJson(turn.text);
    if (answer === undefined) return failed(invalidOutput("the answer isn't one JSON object"));
    return ok({ answer, tokens: turn.tokens, costUsd: turn.costUsd, reads: turn.reads });
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
  /** Default: every 2 seconds. */
  readonly roundsPollMs?: number;
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
  const directories = createHarnessDirectories();

  /** Calls with the run's harness in its directory, or without one when there's nothing to read. */
  const callInDirectory = async (
    harness: InputHarness | null,
    call: (harness: PassHarness | null) => Promise<Result<OpencodeAnswer, PassError>>,
  ): Promise<Result<OpencodeAnswer, PassError>> => {
    if (harness === null) return call(null);
    let written = false;
    try {
      return await directories.use(harness, (directory) => {
        written = true;
        return call({ directory, files: new Set(harness.contents.keys()) });
      });
    } catch (error) {
      if (written) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      return err(readerFailed(`The harness's files couldn't be written: ${reason}`));
    }
  };

  return createPassModel({
    version: opencodeVersion(providerID, model, effort),
    readsHarness: true,

    async checkSize(input) {
      const inputTokens = estimateTokens(
        prEntry(renderInput(input)) +
          passText("intent", passMessage("intent", null, undefined, input)),
      );
      logger.debug("Estimated the input", { inputTokens, maxInputTokens });
      return inputTokens > maxInputTokens
        ? err(tooLarge(inputTokens, maxInputTokens))
        : ok({ inputTokens });
    },

    async runPass(pass, given, intent, passOptions) {
      const input = passOptions?.withoutReader === true ? { ...given, harness: null } : given;
      const callWith = (harness: PassHarness | null) =>
        runOpencodeCall(
          client,
          opencodeRequest(
            pass,
            renderInput(input),
            passMessage(pass, intent, passOptions?.feedback, input),
            ref,
            {
              ...(options.variants === undefined ? {} : { variants: options.variants }),
              ...(effort === undefined ? {} : { effort }),
              harness,
            },
          ),
          options.timeoutMs,
          harness === null
            ? null
            : {
                harness,
                ...(options.roundsPollMs === undefined ? {} : { pollMs: options.roundsPollMs }),
              },
        );
      logger.debug("Model pass started", {
        pass,
        transport: "opencode",
        attempt: passOptions?.feedback ? "retry" : "first",
      });

      const called = await callInDirectory(input.harness, callWith);
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
      const { reads } = called.value;
      return ok({ answer: called.value.answer, usage, ...(reads.length > 0 ? { reads } : {}) });
    },
  });
};
