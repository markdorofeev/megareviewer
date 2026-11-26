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

/** Windows has no process groups. */
const GROUPS = process.platform !== "win32";

export const runDownload: RunDownload = ({ args, env, signal }) =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve({ code: null, stdout: Buffer.alloc(0), stderr: "" });
      return;
    }
    const child = spawn("git", [...args], {
      env: { ...env },
      stdio: ["ignore", "pipe", "pipe"],
      // A group of its own: killing git alone leaves the helper that talks to the host running.
      detached: GROUPS,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let grace: NodeJS.Timeout | undefined;
    const send = (name: NodeJS.Signals) => {
      if (child.pid === undefined) return;
      try {
        if (GROUPS) process.kill(-child.pid, name);
        else child.kill(name);
      } catch {
        // It ended meanwhile.
      }
    };
    const kill = () => {
      send("SIGTERM");
      grace = setTimeout(() => {
        send("SIGKILL");
        // "close" waits for whoever still holds these, such as the helper on Windows.
        child.stdout.destroy();
        child.stderr.destroy();
      }, KILL_GRACE_MS);
    };
    // In its own group, git doesn't get the terminal's Ctrl+C, nor end with megareviewer.
    const killNow = () => send("SIGKILL");
    process.once("exit", killNow);
    signal.addEventListener("abort", kill, { once: true });
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    const finish = (code: number | null, error = "") => {
      clearTimeout(grace);
      process.removeListener("exit", killNow);
      signal.removeEventListener("abort", kill);
      const printed = Buffer.concat(stderr).toString("utf8").trim();
      resolve({ code, stdout: Buffer.concat(stdout), stderr: printed === "" ? error : printed });
    };
    child.on("error", () => finish(null, "git couldn't be started"));
    child.on("close", (code) => finish(code));
  });
