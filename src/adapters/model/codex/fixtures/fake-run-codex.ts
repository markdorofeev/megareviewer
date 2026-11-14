import { readFileSync } from "node:fs";
import type { ModelPass } from "../../../../domain/review/index.ts";
import type { RunCommandOptions } from "../../shared/run-command.ts";
import type { CodexRun, RunCodex } from "../run-codex.ts";
import synthetic from "./errors.synthetic.json" with { type: "json" };

export type RecordedRun =
  | ModelPass
  | "not-signed-in"
  | "command"
  | "mcp-call"
  | "agent-tool"
  | "api-key-rejected";

export const recordedLines = (name: RecordedRun): string[] =>
  readFileSync(new URL(`./${name}.jsonl`, import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line !== "");

export type SyntheticRun = keyof typeof synthetic;

export const syntheticLines = (name: SyntheticRun): string[] =>
  synthetic[name].map((event) => JSON.stringify(event));

export interface FakeRunCall {
  readonly args: readonly string[];
  readonly options: RunCommandOptions;
  readonly result: CodexRun;
}

type Answer = readonly string[] | Partial<CodexRun>;

const PASS = /^Task: (intent|findings|risk|decisions)\./m;

/**
 * Answers each run with the lines `answer` gives for its pass, read from the message on stdin,
 * feeding them to `onLine` and stopping as a killed process would. Arguments that name files are
 * given "/tmp/run".
 */
export const createFakeRunCodex = (
  answer: (pass: ModelPass | null, args: readonly string[]) => Answer,
) => {
  const calls: FakeRunCall[] = [];
  const run: RunCodex = async (argsOf, options = {}) => {
    const args = typeof argsOf === "function" ? argsOf("/tmp/run") : argsOf;
    const matched = PASS.exec(options.stdin ?? "")?.[1];
    const pass = ModelPassOf(matched);
    const answered = answer(pass, args);
    let result: CodexRun;
    if (Array.isArray(answered)) {
      const lines: string[] = [];
      let killed: CodexRun["killed"] = null;
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

const ModelPassOf = (name: string | undefined): ModelPass | null =>
  name === "intent" || name === "findings" || name === "risk" || name === "decisions" ? name : null;
