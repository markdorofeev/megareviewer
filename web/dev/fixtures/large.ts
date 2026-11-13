import type { AnalysisView } from "../../../contracts/index.ts";
import {
  type CallGraphHint,
  type FileChange,
  type HunkId,
  parseUnifiedDiff,
} from "../../../src/domain/diff/index.ts";
import {
  type Analysis,
  type AnalysisKey,
  analysisId,
  DecisionId,
  type PullRequest,
  type RiskAssessment,
  TourStepId,
} from "../../../src/domain/review/index.ts";
import { fixtureAnalysisView } from "./analysis.ts";
import { callSitesOf } from "./call-sites.ts";

// A long PR, for checking the review page stays fast: 60 files of 4 hunks each, without the model.
// Each hunk calls the same hunk of the next file, so the call graph has long chains.

const MODULES = 6;
const FILES = 60;
const HUNKS_PER_FILE = 4;
/** Lines between hunks in a file, so they never touch. */
const SPACING = 40;

const pathOf = (file: number) => `src/module${file % MODULES}/part${file}.ts`;

/** A stable spread of hunk sizes, 1 to 30 added lines. */
const added = (file: number, hunk: number) => 1 + ((file * 7 + hunk * 13) % 30);

const fileDiff = (file: number): string => {
  const path = pathOf(file);
  let shift = 0;
  const hunks = Array.from({ length: HUNKS_PER_FILE }, (_, hunk) => {
    const start = 1 + hunk * SPACING;
    const name = `step${file}_${hunk}`;
    const next = `step${file + 1}_${hunk}`;
    const body = Array.from(
      { length: added(file, hunk) },
      (_, at) =>
        `+  const value${at} = ${at === 0 && file + 1 < FILES ? `${next}(input)` : `input + ${at}`};`,
    );
    const lines = [
      ` // ${name}`,
      `-export const ${name} = (input: number): number => input;`,
      `+export const ${name} = (input: number): number => {`,
      ...body,
      "+  return value0;",
      "+};",
      " ",
    ];
    const oldCount = lines.filter((line) => !line.startsWith("+")).length;
    const newCount = lines.filter((line) => !line.startsWith("-")).length;
    const header = `@@ -${start},${oldCount} +${start + shift},${newCount} @@`;
    shift += newCount - oldCount;
    return [header, ...lines];
  });
  return [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    ...hunks.flat(),
  ]
    .map((line) => `${line}\n`)
    .join("");
};

const DIFF = Array.from({ length: FILES }, (_, file) => fileDiff(file)).join("");
const parsed = parseUnifiedDiff(DIFF);
if (!parsed.ok) throw new Error(`large fixture diff: line ${parsed.error.line}`);
const files: readonly FileChange[] = parsed.value.map((file) => ({
  ...file,
  language: "typescript",
}));

const hunkAt = (file: number, hunk: number): HunkId => {
  const id = files[file]?.hunks[hunk]?.id;
  if (id === undefined) throw new Error(`large fixture: no hunk ${hunk} in file ${file}`);
  return id;
};

const base = fixtureAnalysisView.analysis;
if (base.pullRequest === null) throw new Error("the fixture has no pull request");
const pullRequest: PullRequest = {
  ...base.pullRequest,
  ref: { ...base.pullRequest.ref, number: 900 },
  url: "https://github.com/acme/shop/pull/900",
  title: "Split the pricing pipeline into modules",
  description: "Splits each pricing step into its own function, one module per stage.",
  diff: DIFF,
};
const key: AnalysisKey = {
  ref: pullRequest.ref,
  headSha: pullRequest.headSha,
  pipelineVersion: "17",
};

const risk: RiskAssessment[] = files.flatMap((file, at) =>
  file.hunks.map(
    (hunk): RiskAssessment =>
      at % 7 === 0
        ? {
            hunkId: hunk.id,
            riskClass: "contract",
            reason: "Changes an exported function.",
            source: "rule",
          }
        : { hunkId: hunk.id, riskClass: "logic", reason: "No rule matched.", source: "rule" },
  ),
);

const callGraph: CallGraphHint[] = files.slice(0, -1).flatMap((file, at) =>
  file.hunks.map((hunk, index) => ({
    fromPartId: hunk.id,
    toPartId: hunkAt(at + 1, index),
    symbol: `step${at + 1}_${index}`,
    // The first body line, after the context line and the new signature.
    line: hunk.newStart + 2,
    use: "call" as const,
  })),
);

const analysis: Analysis = {
  ...base,
  id: analysisId(key),
  key,
  stages: {
    ...base.stages,
    intent: "skipped",
    risk: "skipped",
    decisions: "skipped",
    tour: "skipped",
  },
  pullRequest,
  files,
  tickets: [],
  missingTicketKeys: [],
  proofs: [],
  parts: [],
  callGraph,
  fileLinks: files
    .slice(0, -1)
    .map((file, at) => ({ from: file.path, to: files[at + 1]?.path ?? file.path })),
  callSites: callSitesOf(files, callGraph),
  generated: [],
  checkout: "none",
  unchangedCallers: [],
  intent: null,
  risk,
  decisions: [
    {
      id: DecisionId.parse("d1"),
      title: "Prices each step separately",
      category: "behavior",
      whyItMatters: "Rounding now happens once per step.",
      hunkIds: [hunkAt(0, 0), hunkAt(30, 1)],
    },
  ],
  tour: {
    steps: Array.from({ length: MODULES }, (_, module) => ({
      id: TourStepId.parse(`s${module + 1}`),
      title: `Module ${module}`,
      explanation: `The functions of src/module${module}.`,
      partIds: files
        .filter((_, at) => at % MODULES === module)
        .flatMap((file) => file.hunks.map((hunk) => hunk.id)),
      kind: "flow" as const,
      via: [],
      entries: [],
      codeTitle: null,
      merged: [],
    })),
    builtBy: "code",
  },
  warnings: [],
  usage: [],
};

/** A complete analysis of a PR with 240 hunks. */
export const largeAnalysisView: AnalysisView = {
  ...fixtureAnalysisView,
  analysis,
};
