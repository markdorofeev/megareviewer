import type { ModelError } from "../../../domain/review/index.ts";
import { err, ok, type Result } from "../../../domain/shared/index.ts";
import { fromClaudeCodeRun, lockdownProblem, notLockedDown } from "./claude-code-errors.ts";
import { type ClaudeCodeResult, parseClaudeCodeStream, parseInit } from "./claude-code-output.ts";
import { type StructuredCall, structuredCallRequest } from "./claude-code-request.ts";
import type { RunClaude } from "./run-claude.ts";

export interface StructuredAnswer {
  /** Validated by Claude Code against the schema; still untrusted. */
  readonly answer: unknown;
  readonly result: ClaudeCodeResult;
  /** Claude Code's version, from the session's first event. */
  readonly version: string | null;
  /** The model the session was started on and every model that answered in it. */
  readonly models: readonly string[];
}

/**
 * Runs one structured call through Claude Code. Its session is checked on its first event, before
 * the model answers: anything but the StructuredOutput tool, an MCP server, or on a plan an API
 * key in use stops it, so PR text never reaches anything that runs.
 */
export const runStructuredCall = async (
  run: RunClaude,
  call: StructuredCall & { readonly onPlan: boolean },
): Promise<Result<StructuredAnswer, ModelError>> => {
  const request = structuredCallRequest(call);
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
      lockdown = lockdownProblem(init, call.onPlan);
      return lockdown === null ? "continue" : "stop";
    },
  });

  if (lockdown !== null) return err(notLockedDown(lockdown));
  const stream = parseClaudeCodeStream(ran.lines);
  const failure = fromClaudeCodeRun(ran, stream);
  if (failure !== null) return err(failure);
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
  });
};
