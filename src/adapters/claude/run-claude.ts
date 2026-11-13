import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ClaudeRun {
  /** null when the process was killed or couldn't be started. */
  readonly code: number | null;
  /** false when `claude` couldn't be started, such as when it isn't installed. */
  readonly started: boolean;
  readonly lines: readonly string[];
  readonly stderr: string;
  /** Why megareviewer killed it: its line was rejected, it ran too long, or the server closed. */
  readonly killed: "rejected" | "timeout" | "closed" | null;
}

export interface RunClaudeOptions {
  readonly stdin?: string;
  /** Written by name to the new empty directory the process runs in. */
  readonly files?: Readonly<Record<string, string>>;
  /** Called with each line of stdout as it comes; "stop" kills the process. */
  readonly onLine?: (line: string) => "continue" | "stop";
}

/** Runs Claude Code without a shell, in an empty directory removed afterwards. */
export type RunClaude = (args: readonly string[], options?: RunClaudeOptions) => Promise<ClaudeRun>;

/** As the SDK times out a request. */
const TIMEOUT_MS = 10 * 60 * 1000;
const KILL_GRACE_MS = 5_000;

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
): RunClaude => {
  const command = options.command ?? "claude";
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;

  return async (args, runOptions = {}) => {
    const dir = await mkdtemp(join(tmpdir(), "megareviewer-claude-"));
    try {
      for (const [name, content] of Object.entries(runOptions.files ?? {})) {
        await writeFile(join(dir, name), content, { mode: 0o600 });
      }
      return await run(command, args, dir, runOptions, timeoutMs, options.signal);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
};

const run = (
  command: string,
  args: readonly string[],
  cwd: string,
  options: RunClaudeOptions,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<ClaudeRun> =>
  new Promise((resolve) => {
    const child = spawn(command, [...args], {
      cwd,
      env: claudeEnv(process.env),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines: string[] = [];
    const stderr: Buffer[] = [];
    let partial = "";
    let killed: ClaudeRun["killed"] = null;

    const kill = (reason: NonNullable<ClaudeRun["killed"]>) => {
      if (killed !== null || child.exitCode !== null) return;
      killed = reason;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS).unref();
    };
    const timer = setTimeout(() => kill("timeout"), timeoutMs);
    const onAbort = () => kill("closed");
    if (signal?.aborted) onAbort();
    signal?.addEventListener("abort", onAbort);

    const take = (line: string) => {
      if (line === "" || killed !== null) return;
      lines.push(line);
      if (options.onLine?.(line) === "stop") kill("rejected");
    };
    child.stdout.on("data", (chunk: Buffer) => {
      const text = partial + chunk.toString("utf8");
      const split = text.split("\n");
      partial = split.pop() ?? "";
      for (const line of split) take(line);
    });
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    // The process may exit before reading stdin, as when it's killed.
    child.stdin.on("error", () => {});
    let done = false;
    const finish = (code: number | null, started: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      take(partial);
      resolve({
        code: killed === null ? code : null,
        started,
        lines,
        stderr: Buffer.concat(stderr).toString("utf8").trim(),
        killed,
      });
    };
    // Not starting may or may not be followed by "close", depending on how it failed.
    child.on("error", () => finish(null, false));
    child.on("close", (code) => finish(code, true));
    child.stdin.end(options.stdin ?? "");
  });
