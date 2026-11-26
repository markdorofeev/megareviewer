import {
  type Analysis,
  type GuidanceMark,
  HARNESS_ROOT,
  type ModelPass,
} from "../src/domain/review/index.ts";
import type { OutsideFile } from "./guidance.ts";
import type { JudgeVerdict } from "./judge-verdict.ts";
import type { CaseLabels } from "./labels.ts";
import { meetsTarget, type Ratio, type Summary, scoreCase, TARGET_METRICS } from "./score.ts";

/** What one pass read of the harness, its calls together. */
export interface PassReads {
  readonly pass: ModelPass;
  readonly calls: number;
  /** Uses of the read tool that gave something. */
  readonly reads: number;
  /** The files they were of, each once. */
  readonly files: number;
  readonly refused: number;
}

/** How a run used the harness. A run without the reader has no reads, and every count is zero. */
export interface HarnessScore {
  /** Labeled marks of an imported or a linked file that came back, on that file's ref. */
  readonly harnessFollowed: Ratio;
  /** hit: marks of a guideline file, a root among them, on a point no label puts there; total: all. */
  readonly harnessWrong: Ratio;
  /** Labeled reads that happened, by the pass and the file. */
  readonly harnessRead: Ratio;
  /** In the order the passes first ran. */
  readonly passes: readonly PassReads[];
  /** Whether an answer has words of a file outside the harness; null when the case asks for none. */
  readonly outsideQuoted: boolean | null;
}

const isFile = (ref: string): boolean => ref.startsWith("g");

/** The analysis with only the marks of guideline files, which are the harness's. */
const fileMarksOnly = (analysis: Analysis): Analysis => {
  const only = (mark: GuidanceMark | null) => (mark !== null && isFile(mark.ref) ? mark : null);
  return {
    ...analysis,
    findings: analysis.findings.map((one) => ({ ...one, guidance: only(one.guidance) })),
    risk: analysis.risk.map((one) => ({ ...one, guidance: only(one.guidance) })),
  };
};

/** Everything of a run the reviewer or the host could be shown. */
const answersOf = ({ intent, findings, risk, decisions, steps }: Analysis): string =>
  JSON.stringify([intent, findings, risk, decisions, steps]);

export const scoreHarness = (
  analysis: Analysis,
  labels: CaseLabels,
  verdict: JudgeVerdict,
  /** The refs of the case's files that aren't roots, imported or linked. */
  harnessRefs: ReadonlySet<string>,
  outside: OutsideFile | null = null,
): HarnessScore => {
  const files = fileMarksOnly(analysis);
  const ofFiles = (labels.guidance ?? []).filter((label) => isFile(label.ref));
  const marks = scoreCase(files, { ...labels, guidance: ofFiles }, verdict);
  const followed = scoreCase(
    files,
    { ...labels, guidance: ofFiles.filter((label) => harnessRefs.has(label.ref)) },
    verdict,
  );
  const calls = analysis.modelCalls.flatMap((call) =>
    call.pass === "guardrails" ? [] : [{ ...call, pass: call.pass }],
  );
  const passes = [...new Set(calls.map((call) => call.pass))].map((pass): PassReads => {
    const own = calls.filter((call) => call.pass === pass);
    const reads = own.flatMap((call) => call.reads);
    const given = reads.filter((read) => read.outcome === "read");
    return {
      pass,
      calls: own.length,
      reads: given.length,
      files: new Set(given.map((read) => read.path)).size,
      refused: reads.length - given.length,
    };
  });
  const expected = labels.reads ?? [];
  const made = expected.filter(({ pass, path }) =>
    calls.some(
      (call) =>
        call.pass === pass &&
        call.reads.some(
          (read) => read.outcome === "read" && read.path === `${HARNESS_ROOT}/${path}`,
        ),
    ),
  );
  return {
    harnessFollowed: followed.guidanceFollowed,
    harnessWrong: marks.guidanceWrong,
    harnessRead: { hit: made.length, total: expected.length },
    passes,
    outsideQuoted: outside === null ? null : answersOf(analysis).includes(outside.canary),
  };
};

/** What a run spent: its passes' calls that answered, as the usage line counts them. */
export interface RunSpend {
  /** Input not read from the cache. */
  readonly freshTokens: number;
  readonly cacheReadTokens: number;
  readonly outputTokens: number;
  /** At API prices; null when a call's price isn't known. */
  readonly costUsd: number | null;
  /** From the first call to the end of the last, the guardrail call left out. */
  readonly seconds: number;
}

export const spentOn = (analysis: Pick<Analysis, "usage" | "modelCalls">): RunSpend => {
  const usage = analysis.usage.filter((entry) => entry.pass !== "guardrails");
  const calls = analysis.modelCalls.filter((call) => call.pass !== "guardrails");
  const sum = (pick: (entry: (typeof usage)[number]) => number) =>
    usage.reduce((total, entry) => total + pick(entry), 0);
  const start = Math.min(...calls.map((call) => Date.parse(call.startedAt)));
  const end = Math.max(...calls.map((call) => Date.parse(call.startedAt) + call.durationMs));
  return {
    freshTokens: sum((entry) => entry.inputTokens + entry.cacheWriteTokens),
    cacheReadTokens: sum((entry) => entry.cacheReadTokens),
    outputTokens: sum((entry) => entry.outputTokens),
    costUsd: usage.some((entry) => entry.costUsd === null)
      ? null
      : sum((entry) => entry.costUsd ?? 0),
    seconds: calls.length === 0 ? 0 : (end - start) / 1000,
  };
};

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;

const sumRatios = (ratios: readonly Ratio[]): Ratio => ({
  hit: ratios.reduce((total, ratio) => total + ratio.hit, 0),
  total: ratios.reduce((total, ratio) => total + ratio.total, 0),
});

export interface HarnessRun {
  readonly score: HarnessScore;
  readonly spend: RunSpend;
}

/** Several runs of one case, or of several, the same way: the scores added up and what they spent averaged. */
export interface ArmSummary {
  readonly runs: number;
  readonly harnessFollowed: Ratio;
  readonly harnessWrong: Ratio;
  readonly harnessRead: Ratio;
  /** By pass: reads and refusals a run, and how many of the runs it read anything in. */
  readonly passes: readonly {
    readonly pass: ModelPass;
    readonly readsPerRun: number;
    readonly refusedPerRun: number;
    readonly runsThatRead: number;
  }[];
  /** Runs of a case with a file outside that quoted it, of those runs. */
  readonly outsideQuoted: Ratio;
  readonly spend: RunSpend;
}

export const summarizeArm = (runs: readonly HarnessRun[]): ArmSummary => {
  const passes = [...new Set(runs.flatMap(({ score }) => score.passes.map(({ pass }) => pass)))];
  const quoted = runs.flatMap(({ score }) => score.outsideQuoted ?? []);
  const costs = runs.map(({ spend }) => spend.costUsd);
  return {
    runs: runs.length,
    harnessFollowed: sumRatios(runs.map(({ score }) => score.harnessFollowed)),
    harnessWrong: sumRatios(runs.map(({ score }) => score.harnessWrong)),
    harnessRead: sumRatios(runs.map(({ score }) => score.harnessRead)),
    passes: passes.map((pass) => {
      const own = runs.map(({ score }) => score.passes.find((one) => one.pass === pass));
      return {
        pass,
        readsPerRun: mean(own.map((one) => one?.reads ?? 0)),
        refusedPerRun: mean(own.map((one) => one?.refused ?? 0)),
        runsThatRead: own.filter((one) => (one?.reads ?? 0) > 0).length,
      };
    }),
    outsideQuoted: { hit: quoted.filter(Boolean).length, total: quoted.length },
    spend: {
      freshTokens: mean(runs.map(({ spend }) => spend.freshTokens)),
      cacheReadTokens: mean(runs.map(({ spend }) => spend.cacheReadTokens)),
      outputTokens: mean(runs.map(({ spend }) => spend.outputTokens)),
      costUsd: costs.some((cost) => cost === null) ? null : mean(costs.map((cost) => cost ?? 0)),
      seconds: mean(runs.map(({ spend }) => spend.seconds)),
    },
  };
};

/** The metrics that meet their target without the harness attached and miss it with it. */
export const newlyMissed = (without: Summary, attached: Summary): readonly string[] =>
  TARGET_METRICS.filter(
    (metric) => meetsTarget(without, metric) === true && meetsTarget(attached, metric) === false,
  );
