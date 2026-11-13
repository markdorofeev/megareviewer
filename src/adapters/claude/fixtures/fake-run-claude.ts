import { readFileSync } from "node:fs";
import type { ModelPass } from "../../../domain/review/index.ts";
import type { ClaudeRun, RunClaude, RunClaudeOptions } from "../run-claude.ts";
import synthetic from "./claude-code/errors.synthetic.json" with { type: "json" };

/** A recorded run's lines: a pass on small-feature, or the recording signed out. */
export const recordedLines = (name: ModelPass | "not-signed-in"): string[] =>
  readFileSync(new URL(`./claude-code/${name}.jsonl`, import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line !== "");

export type SyntheticRun = keyof typeof synthetic;

export const syntheticLines = (name: SyntheticRun): string[] =>
  synthetic[name].map((event) => JSON.stringify(event));

export interface FakeRunCall {
  readonly args: readonly string[];
  readonly options: RunClaudeOptions;
  readonly result: ClaudeRun;
}

type Answer = readonly string[] | Partial<ClaudeRun>;

/**
 * Answers each run with the lines `answer` gives for its pass, read from the message on stdin,
 * feeding them to `onLine` and stopping as a killed process would.
 */
export const createFakeRunClaude = (
  answer: (pass: ModelPass | null, args: readonly string[]) => Answer,
) => {
  const calls: FakeRunCall[] = [];
  const run: RunClaude = async (args, options = {}) => {
    const pass = /^Task: (\w+)\./m.exec(options.stdin ?? "")?.[1] as ModelPass | undefined;
    const answered = answer(pass ?? null, args);
    let result: ClaudeRun;
    if (Array.isArray(answered)) {
      const lines: string[] = [];
      let killed: ClaudeRun["killed"] = null;
      for (const line of answered as readonly string[]) {
        lines.push(line);
        if (options.onLine?.(line) === "stop") {
          killed = "rejected";
          break;
        }
      }
      result = { code: killed === null ? 0 : null, started: true, lines, stderr: "", killed };
    } else {
      result = { code: 0, started: true, lines: [], stderr: "", killed: null, ...answered };
    }
    calls.push({ args, options, result });
    return result;
  };
  return { run, calls };
};
