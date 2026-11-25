import { spawn } from "node:child_process";
import type { GitOutput } from "./run-git.ts";

export interface DownloadCall {
  readonly args: readonly string[];
  /** The whole environment: nothing is added to it. */
  readonly env: Readonly<Record<string, string>>;
  /** Aborted to kill it. */
  readonly signal: AbortSignal;
}

/** Runs git for a download, without a shell. Apart from `runGit`, which can reach no remote. */
export type RunDownload = (call: DownloadCall) => Promise<GitOutput>;

const KILL_GRACE_MS = 5_000;

export const runDownload: RunDownload = ({ args, env, signal }) =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve({ code: null, stdout: Buffer.alloc(0), stderr: "" });
      return;
    }
    const child = spawn("git", [...args], { env: { ...env }, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const kill = () => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS).unref();
    };
    signal.addEventListener("abort", kill);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    const finish = (code: number | null, error = "") => {
      signal.removeEventListener("abort", kill);
      const printed = Buffer.concat(stderr).toString("utf8").trim();
      resolve({ code, stdout: Buffer.concat(stdout), stderr: printed === "" ? error : printed });
    };
    child.on("error", () => finish(null, "git couldn't be started"));
    child.on("close", (code) => finish(code));
  });
