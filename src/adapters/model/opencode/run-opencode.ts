import { createRunCommand, type RunCommand } from "../shared/run-command.ts";

export type RunOpencode = RunCommand;

/** Runs `opencode` without a shell, for its version: the passes go through its server. */
export const createRunOpencode = (
  options: {
    /** For tests: another executable in place of `opencode`. */
    readonly command?: string;
  } = {},
): RunOpencode =>
  createRunCommand({
    command: options.command ?? "opencode",
    env: (env) =>
      Object.fromEntries(
        Object.entries(env).flatMap(([name, value]) =>
          value === undefined ? [] : [[name, value]],
        ),
      ),
    prefix: "megareviewer-opencode-",
    timeoutMs: 30_000,
  });
