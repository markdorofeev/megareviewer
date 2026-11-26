import { lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RunClaude } from "../src/adapters/model/index.ts";
import { passMessage } from "../src/adapters/model/shared/prompts/passes.ts";
import type { AnalysisInput, AnalysisModel } from "../src/application/ports/index.ts";
import { NO_GUIDANCE } from "../src/application/ports/index.ts";
import type { CaseGuidance, OutsideFile } from "./guidance.ts";

/**
 * How a run reads the harness. on: as the product does. off: the model doesn't read, so a run has
 * the files in the prompt and no index. index-alone: the index and the tool, without the line
 * after each task that asks the pass to read first.
 */
export const READERS = ["on", "off", "index-alone"] as const;
export type Reader = (typeof READERS)[number];

export const parseReader = (value: string): Reader | null =>
  READERS.find((reader) => reader === value) ?? null;

const ROOT = { ref: "g1", path: "CLAUDE.md", linkedFrom: null, content: "" };

/** What a pass that can read is asked after its task, taken from the prompts so it can't drift. */
export const readFirstLine = (): string => {
  const guidance = { preferences: [], guidelines: [ROOT] };
  const task = passMessage("risk", null, undefined, { guidance, harness: null });
  const asked = passMessage("risk", null, undefined, {
    guidance,
    harness: { files: [], contents: new Map() },
  });
  if (!asked.startsWith(task) || asked === task) {
    throw new Error("the line that asks a pass to read isn't after its task any more");
  }
  return asked.slice(task.length);
};

/** The runner, with that line taken out of each pass's message. */
const withoutReadFirst = (run: RunClaude): RunClaude => {
  const line = readFirstLine();
  return (args, options) =>
    run(args, {
      ...options,
      ...(options?.stdin === undefined ? {} : { stdin: options.stdin.replace(line, "") }),
    });
};

export const runnerFor = (reader: Reader, run: RunClaude): RunClaude =>
  reader === "index-alone" ? withoutReadFirst(run) : run;

export const modelFor = (reader: Reader, model: AnalysisModel): AnalysisModel =>
  reader !== "off"
    ? model
    : {
        version: model.version,
        readsHarness: false,
        checkSize: (input) => model.checkSize(input),
        intent: (input, options) => model.intent(input, options),
        findings: (input, intent, options) => model.findings(input, intent, options),
        risk: (input, options) => model.risk(input, options),
        decisions: (input, options) => model.decisions(input, options),
        steps: (input, options) => model.steps(input, options),
      };

/**
 * What the judge reads: the PR with the files in the prompt, and of a linked file its rule, which
 * is all the labels are about, as a guideline file is shown. A harness attached to a case that has
 * none is left out, so the case is judged by the prompt it always was.
 */
export const judgedInput = (
  input: AnalysisInput,
  guidance: CaseGuidance | undefined,
  attached: boolean,
): AnalysisInput => {
  if (attached) return { ...input, guidance: NO_GUIDANCE, harness: null };
  const { guidelines } = input.guidance;
  const rules = (guidance?.linked ?? []).flatMap(({ path, rule }, index) =>
    rule === undefined
      ? []
      : [
          {
            ref: `g${guidelines.length + index + 1}`,
            path,
            linkedFrom: guidance?.guidelines[0]?.path ?? null,
            content: rule,
          },
        ],
  );
  return {
    ...input,
    guidance: { ...input.guidance, guidelines: [...guidelines, ...rules] },
    harness: null,
  };
};

/** The refs of a case's files that aren't roots, as a run numbers them. */
export const harnessRefsOf = (guidance: CaseGuidance | undefined): ReadonlySet<string> => {
  const roots = guidance?.guidelines.length ?? 0;
  const others = [...(guidance?.imported ?? []), ...(guidance?.linked ?? [])];
  return new Set(others.map((_, index) => `g${roots + index + 1}`));
};

/** Whether something is at a path, and if so whether it's a file and not a link to one. */
const atPath = async (path: string): Promise<"nothing" | "file" | "other"> => {
  try {
    return (await lstat(path)).isFile() ? "file" : "other";
  } catch {
    return "nothing";
  }
};

/**
 * Makes the files cases ask for outside the harness. They stay: each is a line of made-up text in
 * the temporary directory, and the next run writes the same over it.
 */
export const makeOutside = async (files: readonly OutsideFile[]): Promise<void> => {
  for (const { path, content } of files) {
    if ((await atPath(path)) === "other") throw new Error(`${path} isn't a file`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, { mode: 0o600 });
  }
};
