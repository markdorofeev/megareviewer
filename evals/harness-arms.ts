import { z } from "zod";
import { ModelPass } from "../src/domain/review/index.ts";
import { type ArmSummary, type HarnessRun, newlyMissed, summarizeArm } from "./harness-score.ts";
import { READERS, type Reader } from "./reader.ts";
import { type CaseScore, type Ratio, type Summary, summarize } from "./score.ts";

const RatioSchema = z.object({ hit: z.number(), total: z.number() });

const Harness = z.object({
  harnessFollowed: RatioSchema,
  harnessWrong: RatioSchema,
  harnessRead: RatioSchema,
  passes: z.array(
    z.object({
      pass: ModelPass,
      calls: z.number(),
      reads: z.number(),
      files: z.number(),
      refused: z.number(),
    }),
  ),
  outsideQuoted: z.boolean().nullable(),
});

const Spend = z.object({
  freshTokens: z.number(),
  cacheReadTokens: z.number(),
  outputTokens: z.number(),
  costUsd: z.number().nullable(),
  seconds: z.number(),
});

/** What the report reads of a results file run.ts wrote. */
export const ArmFile = z.object({
  startedAt: z.string(),
  modelVersion: z.string(),
  reader: z.enum(READERS),
  withHarness: z.boolean(),
  runs: z.number(),
  cases: z.array(
    z.object({
      name: z.string(),
      run: z.number(),
      status: z.enum(["scored", "error"]),
      error: z.string().nullable(),
      cost: z.object({ modelUsd: z.number(), judgeUsd: z.number(), latencyS: z.number() }),
      // Written by the code that reads it, so its shape is run.ts's own.
      score: z.custom<CaseScore>((value) => typeof value === "object" && value !== null).nullable(),
      harness: Harness.nullable(),
      spend: Spend.nullable(),
    }),
  ),
});
export type ArmFile = z.infer<typeof ArmFile>;
type CaseRow = ArmFile["cases"][number];

/** One case, read one way. */
export interface CaseArm {
  readonly name: string;
  readonly model: string;
  readonly reader: Reader;
  readonly attached: boolean;
  readonly summary: ArmSummary;
  /** Runs that weren't scored, which are in nothing else here. */
  readonly errors: number;
}

export interface ArmComparison {
  readonly arms: readonly CaseArm[];
  /** The large harness attached, beside the same cases without it; null without both. */
  readonly attached: {
    readonly cases: readonly string[];
    readonly missed: readonly string[];
    readonly without: Summary;
    readonly attached: Summary;
  } | null;
}

const runsOf = (rows: readonly CaseRow[]): HarnessRun[] =>
  rows.flatMap((row) =>
    row.status === "scored" && row.harness !== null && row.spend !== null
      ? [{ score: row.harness, spend: row.spend }]
      : [],
  );

const summaryOf = (rows: readonly CaseRow[]): Summary =>
  summarize(
    rows.length,
    rows.flatMap((row) => row.score ?? []),
    rows.map((row) => row.cost),
  );

export const compareArms = (files: readonly ArmFile[]): ArmComparison => {
  const grouped = new Map<string, { readonly file: ArmFile; readonly rows: CaseRow[] }>();
  for (const file of files) {
    for (const row of file.cases) {
      const key = [row.name, file.modelVersion, file.reader, file.withHarness].join("\n");
      const arm = grouped.get(key) ?? { file, rows: [] };
      arm.rows.push(row);
      grouped.set(key, arm);
    }
  }
  const arms = [...grouped.values()]
    .flatMap(({ file, rows }): CaseArm[] => {
      const [first] = rows;
      const errors = rows.filter((row) => row.status === "error").length;
      const summary = summarizeArm(runsOf(rows));
      // A case without a harness has nothing to say here.
      return first === undefined || summary.runs + errors === 0
        ? []
        : [
            {
              name: first.name,
              model: file.modelVersion,
              reader: file.reader,
              attached: file.withHarness,
              summary,
              errors,
            },
          ];
    })
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        a.model.localeCompare(b.model) ||
        READERS.indexOf(a.reader) - READERS.indexOf(b.reader),
    );

  const rowsWhere = (withHarness: boolean) =>
    files.filter((file) => file.withHarness === withHarness).flatMap((file) => file.cases);
  const withIt = rowsWhere(true);
  const without = rowsWhere(false);
  const both = new Set(
    withIt.map((row) => row.name).filter((name) => without.some((row) => row.name === name)),
  );
  const pair = (rows: readonly CaseRow[]) => summaryOf(rows.filter((row) => both.has(row.name)));
  return {
    arms,
    attached:
      both.size === 0
        ? null
        : {
            cases: [...both].sort(),
            missed: newlyMissed(pair(without), pair(withIt)),
            without: pair(without),
            attached: pair(withIt),
          },
  };
};

const showRatio = ({ hit, total }: Ratio): string => (total === 0 ? "–" : `${hit}/${total}`);
const thousands = (tokens: number): string => `${(tokens / 1000).toFixed(1)}k`;
const dollars = (usd: number | null): string =>
  usd === null ? "cost unknown" : `$${usd.toFixed(3)}`;

const showSpend = ({ spend }: ArmSummary, off: ArmSummary | undefined): string => {
  const own =
    `${thousands(spend.freshTokens)} fresh + ${thousands(spend.cacheReadTokens)} cached in, ` +
    `${thousands(spend.outputTokens)} out, ${dollars(spend.costUsd)}, ${spend.seconds.toFixed(0)} s`;
  if (off === undefined) return own;
  const { freshTokens, cacheReadTokens, costUsd, seconds } = off.spend;
  return `${own} (without the reader: ${thousands(freshTokens)} + ${thousands(cacheReadTokens)} in, ${dollars(costUsd)}, ${seconds.toFixed(0)} s)`;
};

const showArm = (arm: CaseArm, off: CaseArm | undefined): string[] => {
  const { summary } = arm;
  const reads = summary.passes.map(({ pass, readsPerRun, refusedPerRun, runsThatRead }) => {
    const refused = refusedPerRun > 0 ? `, ${refusedPerRun.toFixed(1)} refused` : "";
    return `${pass} ${readsPerRun.toFixed(1)} (${runsThatRead}/${summary.runs} runs${refused})`;
  });
  return [
    `${arm.name} · reader ${arm.reader}${arm.attached ? " · large harness attached" : ""} · ${arm.model} · ${summary.runs} runs${arm.errors > 0 ? ` · ${arm.errors} not scored` : ""}`,
    `  followed ${showRatio(summary.harnessFollowed)} · wrong ${showRatio(summary.harnessWrong)} · read as labeled ${showRatio(summary.harnessRead)}` +
      (summary.outsideQuoted.total === 0
        ? ""
        : ` · quoted from outside ${showRatio(summary.outsideQuoted)}`),
    `  reads a run: ${reads.join(" · ") || "none"}`,
    `  ${showSpend(summary, off?.summary)}`,
  ];
};

export const showArms = ({ arms, attached }: ArmComparison): string => {
  const lines = arms.flatMap((arm) =>
    showArm(
      arm,
      arm.reader === "off"
        ? undefined
        : arms.find(
            (other) =>
              other.reader === "off" &&
              other.name === arm.name &&
              other.model === arm.model &&
              other.attached === arm.attached,
          ),
    ),
  );
  if (attached !== null) {
    lines.push(
      `${attached.cases.length} cases with the large harness attached: ${
        attached.missed.length === 0
          ? "no metric that met its target without it misses it."
          : `misses a target it met without: ${attached.missed.join(", ")}.`
      }`,
    );
  }
  return lines.join("\n");
};
