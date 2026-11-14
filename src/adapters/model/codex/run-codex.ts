import { type CommandRun, createRunCommand, type RunCommand } from "../shared/run-command.ts";

export type CodexRun = CommandRun;
export type RunCodex = RunCommand;

/**
 * The server's environment without what would change who pays or where requests go:
 * CODEX_API_KEY wins over the ChatGPT sign-in (measured on 0.162.0), and OPENAI_* holds keys and
 * base URLs. CODEX_HOME stays: it's where the reviewer signed in.
 */
export const codexEnv = (env: NodeJS.ProcessEnv): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).flatMap(([name, value]) =>
      value === undefined || (/^(OPENAI_|CODEX_)/.test(name) && name !== "CODEX_HOME")
        ? []
        : [[name, value] as const],
    ),
  );

/** Runs Codex without a shell, in a new empty directory (mode 0700) removed afterwards. */
export const createRunCodex = (
  options: {
    /** Aborted when the server closes, which kills every running process. */
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
    /** For tests: another executable in place of `codex`. */
    readonly command?: string;
  } = {},
): RunCodex =>
  createRunCommand({
    command: options.command ?? "codex",
    env: codexEnv,
    prefix: "megareviewer-codex-",
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
