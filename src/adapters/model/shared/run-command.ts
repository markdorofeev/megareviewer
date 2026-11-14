import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface CommandRun {
  /** null when the process was killed or couldn't be started. */
  readonly code: number | null;
  /** false when the command couldn't be started, such as when it isn't installed. */
  readonly started: boolean;
  readonly lines: readonly string[];
  readonly stderr: string;
  /** Why megareviewer killed it: its line was rejected, it ran too long, or the server closed. */
  readonly killed: "rejected" | "timeout" | "closed" | null;
}

export interface RunCommandOptions {
  readonly stdin?: string;
  /** Written by name to the new empty directory the process runs in. */
  readonly files?: Readonly<Record<string, string>>;
  /** Made, empty, in that directory. */
  readonly dirs?: readonly string[];
  /** Called with each line of stdout as it comes; "stop" kills the process. */
  readonly onLine?: (line: string) => "continue" | "stop";
}

/**
 * Runs a command without a shell, in a new empty directory removed afterwards. Arguments that
 * name its files are given the directory.
 */
export type RunCommand = (
  args: readonly string[] | ((dir: string) => readonly string[]),
  options?: RunCommandOptions,
) => Promise<CommandRun>;

/** As the SDK times out a request. */
const TIMEOUT_MS = 10 * 60 * 1000;
const KILL_GRACE_MS = 5_000;

export interface RunCommandSettings {
  readonly command: string;
  /** The child's environment, from the server's. */
  readonly env: (env: NodeJS.ProcessEnv) => Record<string, string>;
  /** The temporary directory's name starts with it. */
  readonly prefix: string;
  /** Aborted when the server closes, which kills every running process. */
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export const createRunCommand = (settings: RunCommandSettings): RunCommand => {
  const timeoutMs = settings.timeoutMs ?? TIMEOUT_MS;

  return async (args, options = {}) => {
    const dir = await mkdtemp(join(tmpdir(), settings.prefix));
    try {
      for (const name of options.dirs ?? []) await mkdir(join(dir, name), { mode: 0o700 });
      for (const [name, content] of Object.entries(options.files ?? {})) {
        await writeFile(join(dir, name), content, { mode: 0o600 });
      }
      const resolved = typeof args === "function" ? args(dir) : args;
      return await run(settings, resolved, dir, options, timeoutMs);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
};

const run = (
  settings: RunCommandSettings,
  args: readonly string[],
  cwd: string,
  options: RunCommandOptions,
  timeoutMs: number,
): Promise<CommandRun> =>
  new Promise((resolve) => {
    const { signal } = settings;
    const child = spawn(settings.command, [...args], {
      cwd,
      env: settings.env(process.env),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines: string[] = [];
    const stderr: Buffer[] = [];
    let partial = "";
    let killed: CommandRun["killed"] = null;

    const kill = (reason: NonNullable<CommandRun["killed"]>) => {
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

/** -1, 0 or 1 as `a` is older than, the same as or newer than `b`, both "x.y.z". */
export const compareVersions = (a: string, b: string): number => {
  const [left, right] = [a, b].map((version) => version.split(".").map(Number));
  for (let index = 0; index < 3; index++) {
    const difference = (left?.[index] ?? 0) - (right?.[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
};
