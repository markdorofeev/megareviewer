import type { ModelError, ModelErrorKind } from "../../../domain/review/index.ts";
import { invalidOutput, maxTokens, refusal } from "../shared/errors.ts";
import type { ClaudeCodeInit, ClaudeCodeStream } from "./claude-code-output.ts";
import { CLAUDE_CODE_MAX_OUTPUT_TOKENS, STRUCTURED_OUTPUT_TOOL } from "./claude-code-request.ts";
import type { ClaudeRun } from "./run-claude.ts";

const modelError = (kind: ModelErrorKind, message: string): ModelError => ({ kind, message });

export const NOT_INSTALLED =
  "Claude Code couldn't be started. Install it (https://code.claude.com), then restart megareviewer.";
export const NOT_SIGNED_IN =
  "Claude Code isn't signed in. Run `claude` and sign in, then try again.";

/**
 * Why a pass's session isn't locked down, or null when it is: StructuredOutput is its only
 * tool, it has no MCP servers, and on a plan no API key is in use. Checked on the first event,
 * before the model answers, so a Claude Code update that changes a flag's meaning fails here
 * instead of handing PR text a shell.
 */
export const lockdownProblem = (init: ClaudeCodeInit, onPlan: boolean): string | null => {
  const extraTools = init.tools.filter((tool) => tool !== STRUCTURED_OUTPUT_TOOL);
  if (extraTools.length > 0) return `it had tools: ${extraTools.join(", ")}`;
  if (!init.tools.includes(STRUCTURED_OUTPUT_TOOL)) return "it had no StructuredOutput tool";
  if (init.mcpServers.length > 0) return `it had MCP servers: ${init.mcpServers.join(", ")}`;
  if (onPlan && init.apiKeySource !== null && init.apiKeySource !== "none") {
    return `it would bill an API key (${init.apiKeySource}) instead of the Claude plan`;
  }
  return null;
};

export const notLockedDown = (problem: string): ModelError =>
  modelError(
    "unexpected",
    `Claude Code's session wasn't locked down, so the pass was stopped: ${problem}.`,
  );

const resetsAt = (seconds: number | null): string =>
  seconds === null
    ? "Try again when it resets."
    : `It resets at ${new Date(seconds * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}.`;

const lastLine = (text: string): string => text.trim().split("\n").at(-1) ?? "";

const NETWORK =
  /connection error|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|fetch failed/i;

/**
 * Why a pass failed, or null when it has an answer. Nothing is retried here: the pipeline
 * retries a pass once on an invalid answer, as for the API.
 */
export const fromClaudeCodeRun = (
  run: ClaudeRun,
  stream: ClaudeCodeStream,
  outputLimit: number = CLAUDE_CODE_MAX_OUTPUT_TOKENS,
): ModelError | null => {
  if (!run.started) return modelError("unauthorized", NOT_INSTALLED);
  if (run.killed === "timeout") {
    return modelError("unexpected", "Claude Code didn't finish the pass in 10 minutes.");
  }
  if (run.killed === "closed") {
    return modelError("unexpected", "The pass was stopped because megareviewer is closing.");
  }

  const { result, error, rateLimit } = stream;
  const code = error?.code ?? null;
  const text = `${error?.text ?? ""}\n${result?.text ?? ""}`;
  const status = result?.apiErrorStatus ?? null;

  if (code === "authentication_failed" || /not logged in|please run \/login/i.test(text)) {
    return modelError("unauthorized", NOT_SIGNED_IN);
  }
  if (code === "rate_limit" || rateLimit?.status === "rejected" || status === 429) {
    return modelError(
      "rate-limited",
      `Your Claude plan's usage limit is reached. ${resetsAt(rateLimit?.resetsAt ?? null)}`,
    );
  }
  if (code === "billing_error") {
    return modelError("unauthorized", `Claude Code can't bill this account: ${lastLine(text)}`);
  }
  if (code === "server_error" || (status !== null && status >= 500)) {
    return modelError("overloaded", `Anthropic is overloaded or failing: ${lastLine(text)}`);
  }
  if (/prompt is too long/i.test(text)) {
    return modelError("too-large", "The pull request is too long for the model's context window.");
  }
  if (code === "max_output_tokens" || result?.stopReason === "max_tokens") {
    return maxTokens(outputLimit);
  }
  if (result?.stopReason === "refusal" && result.structuredOutput === undefined) {
    return refusal(null);
  }
  if (NETWORK.test(text)) {
    return modelError("network", `Claude Code can't reach Anthropic: ${lastLine(text)}`);
  }
  if (result !== null && !result.isError && result.structuredOutput !== undefined) return null;
  if (result?.subtype === "error_max_turns") {
    return invalidOutput("Claude Code ran out of turns without giving an answer");
  }

  const detail = lastLine(run.stderr) || lastLine(text) || `exit code ${run.code ?? "none"}`;
  return modelError("unexpected", `Claude Code failed: ${detail}`);
};
