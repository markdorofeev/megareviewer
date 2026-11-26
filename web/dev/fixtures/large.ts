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
} from "../../../src/domain/review/index.ts";
import { fixtureAnalysisView } from "./analysis.ts";
import { callSitesOf } from "./call-sites.ts";

// Synthetic PRs without the model: each file's hunks call the same hunk of the next file, so the
// call graph has long chains. The large one checks the review page stays fast; the many-folder ones
// show the file tree on the path shapes of real repositories.

const MODULES = 6;
/** Lines between hunks in a file, so they never touch. */
const SPACING = 40;

/** A stable spread of hunk sizes, 1 to 30 added lines. */
const added = (file: number, hunk: number) => 1 + ((file * 7 + hunk * 13) % 30);

const fileDiff = (path: string, file: number, files: number, hunksPerFile: number): string => {
  let shift = 0;
  const hunks = Array.from({ length: hunksPerFile }, (_, hunk) => {
    const start = 1 + hunk * SPACING;
    const name = `step${file}_${hunk}`;
    const next = `step${file + 1}_${hunk}`;
    const body = Array.from(
      { length: added(file, hunk) },
      (_, at) =>
        `+  const value${at} = ${at === 0 && file + 1 < files ? `${next}(input)` : `input + ${at}`};`,
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

const base = fixtureAnalysisView.analysis;
if (base.pullRequest === null) throw new Error("the fixture has no pull request");

const directoryOf = (path: string): string => path.slice(0, Math.max(path.lastIndexOf("/"), 0));

/** A complete analysis, without the model, of a PR changing these files. */
export const syntheticAnalysisView = ({
  number,
  title,
  description,
  paths,
  hunksPerFile,
}: {
  readonly number: number;
  readonly title: string;
  readonly description: string;
  readonly paths: readonly string[];
  readonly hunksPerFile: number;
}): AnalysisView => {
  const basePullRequest = base.pullRequest;
  if (basePullRequest === null) throw new Error("the fixture has no pull request");
  const directories = [...new Set(paths.map(directoryOf))];
  const diff = paths.map((path, file) => fileDiff(path, file, paths.length, hunksPerFile)).join("");
  const parsed = parseUnifiedDiff(diff);
  if (!parsed.ok) throw new Error(`synthetic fixture diff: line ${parsed.error.line}`);
  const files: readonly FileChange[] = parsed.value.map((file) => ({
    ...file,
    language: "typescript",
  }));

  const hunkAt = (file: number, hunk: number): HunkId => {
    const id = files[file]?.hunks[hunk]?.id;
    if (id === undefined) throw new Error(`synthetic fixture: no hunk ${hunk} in file ${file}`);
    return id;
  };

  const pullRequest: PullRequest = {
    ...basePullRequest,
    ref: { ...basePullRequest.ref, number },
    url: `https://github.com/acme/shop/pull/${number}`,
    title,
    description,
    diff,
  };
  const key: AnalysisKey = {
    ref: pullRequest.ref,
    headSha: pullRequest.headSha,
    pipelineVersion: "21",
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
              lines: null,
              guidance: null,
            }
          : {
              hunkId: hunk.id,
              riskClass: "logic",
              reason: "No rule matched.",
              source: "rule",
              lines: null,
              guidance: null,
            },
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
      steps: "skipped",
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
    definitionCalls: [],
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
        hunkIds: [
          hunkAt(0, 0),
          hunkAt(Math.floor(paths.length / 2), Math.min(1, hunksPerFile - 1)),
        ],
        lines: null,
      },
    ],
    flows: directories.map((directory) => ({
      title: directory === "" ? "Top level" : directory,
      partIds: files
        .filter((file) => directoryOf(file.path) === directory)
        .flatMap((file) => file.hunks.map((hunk) => hunk.id)),
      kind: "flow" as const,
      entries: [],
    })),
    warnings: [],
    usage: [],
  };

  return { ...fixtureAnalysisView, analysis };
};

/** A complete analysis of a PR with 240 hunks. */
export const largeAnalysisView: AnalysisView = syntheticAnalysisView({
  number: 900,
  title: "Split the pricing pipeline into modules",
  description: "Splits each pricing step into its own function, one module per stage.",
  paths: Array.from({ length: 60 }, (_, file) => `src/module${file % MODULES}/part${file}.ts`),
  hunksPerFile: 4,
});
