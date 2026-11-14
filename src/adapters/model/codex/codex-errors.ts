import type { ModelError } from "../../../domain/review/index.ts";
import { modelError, refusal } from "../shared/errors.ts";
import type { CodexStream } from "./codex-output.ts";
import type { CodexRun } from "./run-codex.ts";

export const NOT_INSTALLED =
  "Codex couldn't be started. Install the Codex CLI and run `codex login`, then restart megareviewer.";
export const NOT_SIGNED_IN = "Codex isn't signed in. Run `codex login`, then try again.";

/** A tool ran, or was about to: the process was killed, and its answer is never read. */
export const usedTool = (tool: string): ModelError =>
  modelError(
    "unexpected",
    `The session used a tool (${tool}), so the pass was stopped and its answer discarded.`,
  );

const lastLine = (text: string): string => text.trim().split("\n").at(-1) ?? "";

const UNAUTHORIZED = /401|unauthorized|not logged in|missing bearer|incorrect api key/i;
const LIMIT = /usage.?limit|rate.?limit|credits.?depleted|429|too many requests|hit your limit/i;
const TOO_LARGE = /context.?window|context.?length|prompt is too long|input exceeds/i;
const REFUSAL = /content.?filter|refus/i;
const OVERLOADED = /\b5\d\d\b|overloaded|server.?error|service unavailable|internal error/i;
const NETWORK =
  /stream disconnected|error sending request|connection (refused|reset|closed)|dns|timed out|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i;

/**
 * Why a pass failed, or null when Codex gave an answer. Nothing is retried here: Codex retries
 * its own requests, and the pipeline retries a pass once on an invalid answer.
 */
export const fromCodexRun = (run: CodexRun, stream: CodexStream): ModelError | null => {
  if (!run.started) return modelError("unauthorized", NOT_INSTALLED);
  if (run.killed === "timeout") {
    return modelError("unexpected", "Codex didn't finish the pass in 10 minutes.");
  }
  if (run.killed === "closed") {
    return modelError("unexpected", "The pass was stopped because megareviewer is closing.");
  }
  if (run.code === 0 && stream.failure === null) return null;

  const said = stream.failure ?? stream.errors[0] ?? lastLine(run.stderr);
  const text = [stream.failure ?? "", ...stream.errors, run.stderr].join("\n");
  if (UNAUTHORIZED.test(text)) return modelError("unauthorized", NOT_SIGNED_IN);
  if (LIMIT.test(said)) {
    return modelError(
      "rate-limited",
      `Your ChatGPT plan's usage limit is reached. Try again when it resets. Codex said: ${said}`,
    );
  }
  if (TOO_LARGE.test(said)) {
    return modelError("too-large", "The pull request is too long for the model's context window.");
  }
  if (REFUSAL.test(said)) return refusal(null);
  if (OVERLOADED.test(said)) {
    return modelError("overloaded", `OpenAI is overloaded or failing: ${said}`);
  }
  if (NETWORK.test(said)) return modelError("network", `Codex can't reach OpenAI: ${said}`);
  const detail = said || `exit code ${run.code ?? "none"}`;
  return modelError("unexpected", `Codex failed: ${detail}`);
};
