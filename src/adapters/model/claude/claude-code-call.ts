import type { PassError } from "../../../application/ports/index.ts";
import type { HarnessRead, ModelError } from "../../../domain/review/index.ts";
import { err, ok, type Result } from "../../../domain/shared/index.ts";
import { readerFailed, readTooMuch, roundsUsedUp } from "../shared/errors.ts";
import { fromClaudeCodeRun, lockdownProblem, notLockedDown } from "./claude-code-errors.ts";
import { type ClaudeCodeResult, parseClaudeCodeStream, parseInit } from "./claude-code-output.ts";
import { parseReads, readOutside } from "./claude-code-reads.ts";
import {
  claudeCodeOutputLimit,
  READ_TOOLS,
  type StructuredCall,
  structuredCallRequest,
} from "./claude-code-request.ts";
import type { ClaudeRun, RunClaude } from "./run-claude.ts";

const ASSISTANT_EVENT = /^\{"type":"assistant"/;

export interface StructuredAnswer {
  /** Validated by Claude Code against the schema; still untrusted. */
  readonly answer: unknown;
  readonly result: ClaudeCodeResult;
  /** Claude Code's version, from the session's first event. */
  readonly version: string | null;
  /** The model the session was started on and every model that answered in it. */
  readonly models: readonly string[];
  /** What it read of the harness; none without the read tool. */
  readonly reads: readonly HarnessRead[];
}

/** A failure that's the reading's, which the pass can be run again without. */
const readingFailure = (
  failure: ModelError,
  subtype: string | null,
  reads: readonly HarnessRead[],
): ModelError | null => {
  if (failure.kind === "invalid-output" && subtype === "error_max_turns") {
    return roundsUsedUp();
  }
  if (failure.kind === "too-large" && reads.length > 0) {
    return readTooMuch();
  }
  return null;
};

/**
 * Runs one structured call through Claude Code. Its session is checked on its first event, before
 * the model answers: anything but the StructuredOutput tool, an MCP server, or on a plan an API
 * key in use stops it, so PR text never reaches anything that runs. A call with something to read
 * has Claude Code's reader too, and is stopped on a read outside its directory. `onAnswering` is
 * called on the model's first message, which comes once it has read the prompt and so cached it.
 */
export const runStructuredCall = async (
  run: RunClaude,
  call: StructuredCall & { readonly onPlan: boolean; readonly onAnswering?: () => void },
): Promise<Result<StructuredAnswer, PassError>> => {
  const request = structuredCallRequest(call);
  const readable = call.readable ?? null;
  let cwd = "";
  let lockdown: string | null = null;
  let outside: string | null = null;
  let checked = false;
  let answering = false;
  const starting = run(request.args, {
    stdin: request.stdin,
    files: request.files,
    ...(request.workDir === undefined ? {} : { workDir: request.workDir }),
    onStart(dir) {
      cwd = dir;
    },
    onLine(line) {
      if (checked) {
        if (!ASSISTANT_EVENT.test(line)) return "continue";
        if (!answering) {
          answering = true;
          call.onAnswering?.();
        }
        outside = readable === null ? null : readOutside(line, cwd);
        return outside === null ? "continue" : "stop";
      }
      const init = parseInit(line);
      if (init === null) return "continue";
      checked = true;
      lockdown = lockdownProblem(init, call.onPlan, readable === null ? [] : READ_TOOLS);
      return lockdown === null ? "continue" : "stop";
    },
  });
  let ran: ClaudeRun;
  try {
    ran = await starting;
  } catch (error) {
    if (readable === null) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    return err(readerFailed(`The harness's files couldn't be written: ${reason}`));
  }

  const reads = readable === null ? [] : parseReads(ran.lines, cwd, new Set(readable.keys()));
  if (lockdown !== null) {
    const problem = notLockedDown(lockdown);
    return err(readable === null ? problem : readerFailed(problem.message));
  }
  if (outside !== null) {
    return err({ ...readerFailed(`The pass was stopped: ${outside}.`), reads });
  }
  const stream = parseClaudeCodeStream(ran.lines);
  const failure = fromClaudeCodeRun(ran, stream, claudeCodeOutputLimit(call.model));
  if (failure !== null) {
    if (readable === null) return err(failure);
    const reading = readingFailure(failure, stream.result?.subtype ?? null, reads);
    return err({ ...(reading ?? failure), reads });
  }
  // A run with an answer but no init event was never checked for tools.
  if (stream.init === null || stream.result === null) {
    return err(notLockedDown("it reported no session"));
  }
  const started = stream.init.model === null ? [] : [stream.init.model];
  return ok({
    answer: stream.result.structuredOutput,
    result: stream.result,
    version: stream.init.version,
    models: [...new Set([...started, ...stream.models])],
    reads,
  });
};
