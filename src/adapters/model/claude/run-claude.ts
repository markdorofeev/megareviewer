import {
  type CommandRun,
  createRunCommand,
  type RunCommandOptions,
} from "../shared/run-command.ts";

export type ClaudeRun = CommandRun;
export type RunClaudeOptions = RunCommandOptions;

/** Runs Claude Code without a shell, in an empty directory removed afterwards. */
export type RunClaude = (args: readonly string[], options?: RunClaudeOptions) => Promise<ClaudeRun>;

/**
 * The server's environment without what would change who pays or how Claude Code behaves: an
 * API key or token makes it bill the API instead of the plan, a base URL sends the request
 * elsewhere, and a parent Claude Code session's own variables (megareviewer started from one)
 * would make the child act as its subprocess. CLAUDE_CONFIG_DIR stays: it's where the reviewer
 * signed in.
 */
export const claudeEnv = (env: NodeJS.ProcessEnv): Record<string, string> => {
  const kept = Object.entries(env).flatMap(([name, value]) =>
    value === undefined || (/^(ANTHROPIC_|CLAUDE)/.test(name) && name !== "CLAUDE_CONFIG_DIR")
      ? []
      : [[name, value] as const],
  );
  // Turns off Claude Code's own telemetry, error reporting and update checks.
  return { ...Object.fromEntries(kept), CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" };
};

export const createRunClaude = (
  options: {
    /** Aborted when the server closes, which kills every running process. */
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
    /** For tests: another executable in place of `claude`. */
    readonly command?: string;
  } = {},
): RunClaude =>
  createRunCommand({
    command: options.command ?? "claude",
    env: claudeEnv,
    prefix: "megareviewer-claude-",
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
