import { spawn } from "node:child_process";

export interface GitOutput {
  /** null when git couldn't be started, such as when it isn't installed. */
  readonly code: number | null;
  readonly stdout: Buffer;
  readonly stderr: string;
}

/** Runs git in a directory, without a shell, writing `input` to its stdin. */
export type RunGit = (dir: string, args: readonly string[], input?: string) => Promise<GitOutput>;

export const runGit: RunGit = (dir, args, input) =>
  new Promise((resolve) => {
    const child = spawn("git", ["-C", dir, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      // A checkout's own config can't page or prompt for credentials: nothing here reads a remote.
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat", LC_ALL: "C" },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    // git may exit before reading all of stdin, as for a missing commit.
    child.stdin.on("error", () => {});
    child.on("error", () =>
      resolve({ code: null, stdout: Buffer.alloc(0), stderr: "git couldn't be started" }),
    );
    child.on("close", (code) =>
      resolve({
        code,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr).toString("utf8").trim(),
      }),
    );
    child.stdin.end(input ?? "");
  });
