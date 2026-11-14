import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok, type Result } from "../../../domain/shared/index.ts";
import { opencodeConfig } from "./opencode-request.ts";

/** Where the server answers, and the password every request carries. */
export interface OpencodeConnection {
  readonly url: string;
  readonly password: string;
}

/** Why the server isn't running: opencode isn't installed, or it didn't start. */
export interface ServerProblem {
  readonly kind: "not-installed" | "failed";
  readonly message: string;
}

export interface OpencodeServer {
  /** The running server, started on the first call and again after it died. */
  connect(): Promise<Result<OpencodeConnection, ServerProblem>>;
  stop(): void;
}

const START_TIMEOUT_MS = 15_000;
const LISTENING = /listening on (http:\/\/127\.0\.0\.1:\d+)/;

/**
 * The server's environment: the reviewer's, which may name their providers' keys, then ours. The
 * project's config and Claude Code's aren't read, opencode's free models are left out since the
 * reviewer never connected the service they run on, and nothing runs in the background.
 */
export const opencodeEnv = (
  env: NodeJS.ProcessEnv,
  password: string,
): Record<string, string> => ({
  ...Object.fromEntries(
    Object.entries(env).flatMap(([name, value]) => (value === undefined ? [] : [[name, value]])),
  ),
  OPENCODE_SERVER_PASSWORD: password,
  OPENCODE_CONFIG_CONTENT: JSON.stringify(opencodeConfig()),
  OPENCODE_DISABLE_PROJECT_CONFIG: "1",
  OPENCODE_DISABLE_CLAUDE_CODE: "1",
  OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
  OPENCODE_DISABLE_FREE_MODELS: "1",
  OPENCODE_DISABLE_AUTOUPDATE: "1",
  OPENCODE_DISABLE_FILEWATCHER: "1",
});

export interface OpencodeServerOptions {
  /** Aborted when megareviewer closes, which stops the server. */
  readonly signal?: AbortSignal;
  readonly startTimeoutMs?: number;
  /** For tests: another executable in place of `opencode`, and its arguments before ours. */
  readonly command?: string;
  readonly commandArgs?: readonly string[];
}

/**
 * One `opencode serve` for megareviewer's process, on 127.0.0.1 at a port it picks, with a random
 * password, in a new empty directory, started without a shell.
 */
export const createOpencodeServer = (options: OpencodeServerOptions = {}): OpencodeServer => {
  const command = options.command ?? "opencode";
  const timeoutMs = options.startTimeoutMs ?? START_TIMEOUT_MS;
  let starting: Promise<Result<OpencodeConnection, ServerProblem>> | null = null;
  let child: ChildProcess | null = null;
  let dir: string | null = null;

  const cleanUp = () => {
    if (dir !== null) rmSync(dir, { recursive: true, force: true });
    dir = null;
  };

  const stop = () => {
    child?.kill("SIGTERM");
    child = null;
    starting = null;
    cleanUp();
  };
  options.signal?.addEventListener("abort", stop);

  const start = (): Promise<Result<OpencodeConnection, ServerProblem>> =>
    new Promise((resolve) => {
      const password = randomBytes(24).toString("base64url");
      dir = mkdtempSync(join(tmpdir(), "megareviewer-opencode-"));
      const server = spawn(
        command,
        [...(options.commandArgs ?? []), "serve", "--hostname", "127.0.0.1", "--port", "0"],
        { cwd: dir, env: opencodeEnv(process.env, password), stdio: ["ignore", "pipe", "pipe"] },
      );
      child = server;
      // Node doesn't stop its children when it exits, so a crash would leave the server running.
      const killOnExit = () => server.kill("SIGTERM");
      process.once("exit", killOnExit);
      server.on("exit", () => process.removeListener("exit", killOnExit));
      let output = "";
      let settled = false;
      const settle = (result: Result<OpencodeConnection, ServerProblem>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!result.ok) {
          server.kill("SIGTERM");
          if (child === server) {
            child = null;
            starting = null;
            cleanUp();
          }
        }
        resolve(result);
      };
      const timer = setTimeout(
        () =>
          settle(
            err({
              kind: "failed",
              message: `\`opencode serve\` didn't start within ${timeoutMs / 1000} seconds`,
            }),
          ),
        timeoutMs,
      );
      const read = (chunk: Buffer) => {
        output += chunk.toString("utf8");
        const url = LISTENING.exec(output)?.[1];
        if (url !== undefined) settle(ok({ url, password }));
      };
      server.stdout?.on("data", read);
      server.stderr?.on("data", read);
      server.on("error", (error: NodeJS.ErrnoException) =>
        settle(
          err(
            error.code === "ENOENT"
              ? { kind: "not-installed", message: "opencode isn't installed" }
              : { kind: "failed", message: `\`opencode serve\` couldn't start: ${error.message}` },
          ),
        ),
      );
      server.on("exit", (code) => {
        settle(
          err({
            kind: "failed",
            message: `\`opencode serve\` exited (${code ?? "killed"}): ${output.trim().split("\n").at(-1) ?? ""}`,
          }),
        );
        // A server that died is started again on the next use.
        if (child === server) {
          child = null;
          starting = null;
          cleanUp();
        }
      });
    });

  return {
    connect() {
      if (options.signal?.aborted) {
        return Promise.resolve(err({ kind: "failed", message: "megareviewer is closing" }));
      }
      starting ??= start();
      return starting;
    },
    stop,
  };
};
