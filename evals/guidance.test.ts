import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { createTreeSitterCodeParser } from "../src/adapters/treesitter/index.ts";
import type { CodeParser, FindingDraft } from "../src/application/ports/index.ts";
import { FakeAnalysisModel } from "../src/application/testing/index.ts";
import { HunkId } from "../src/domain/diff/index.ts";
import type { Analysis, GuidanceMark } from "../src/domain/review/index.ts";
import { ok } from "../src/domain/shared/index.ts";
import { type EvalCase, evalCases } from "./cases/index.ts";
import { analyzeCase, quietLogger } from "./harness.ts";
import type { JudgeVerdict } from "./judge-verdict.ts";
import { rate, scoreCase } from "./score.ts";

let parser: CodeParser;
beforeAll(async () => {
  parser = await createTreeSitterCodeParser({
    grammarsDir: fileURLToPath(new URL("../src/adapters/treesitter/grammars", import.meta.url)),
  });
});

/** The mark the labels ask for on each labeled finding, by its index. */
const askedMarks = ({ labels }: EvalCase): Map<number, GuidanceMark> =>
  new Map(
    (labels.guidance ?? []).flatMap(({ ref, effect, findings }) =>
      findings.map((index) => [index, { ref, effect }] as const),
    ),
  );

/**
 * The case run through the pipeline with a model that answers what the labels expect: each labeled
 * finding on its first line, with the given marks.
 */
const answered = async (
  evalCase: EvalCase,
  marks: ReadonlyMap<number, GuidanceMark>,
): Promise<Analysis> => {
  const { labels } = evalCase;
  const findings = labels.findings.flatMap((finding, index): FindingDraft[] => {
    const [place] = finding.at;
    if (place === undefined) return [];
    const [line] = place.lines;
    return [
      {
        title: finding.description.slice(0, 80),
        explanation: finding.description,
        lines: { hunkId: HunkId.parse(place.hunkId), side: place.side, startLine: line, line },
        severity: "major",
        suggestion: null,
        mismatch: null,
        guidance: marks.get(index) ?? null,
      },
    ];
  });
  const model = new FakeAnalysisModel();
  model.script("findings", ok(findings));
  const result = await analyzeCase(evalCase.fixture, {
    model,
    parser,
    logger: quietLogger(),
    timeoutMs: 30_000,
    guidance: evalCase.guidance,
  });
  if (!result.ok) throw new Error(result.error);
  return result.value.analysis;
};

/** The judge's answer when each labeled finding is the produced one of its index. */
const verdictFor = ({ labels }: EvalCase, analysis: Analysis): JudgeVerdict => ({
  findings: labels.findings.map((_, expected) => ({ expected, produced: expected })),
  findingRatings: analysis.findings.map((_, produced) => ({ produced, rating: "valid" })),
  mismatches: [],
  injectionReported: false,
});

const guided = evalCases.filter((evalCase) => evalCase.guidance !== undefined);
const named = (name: string): EvalCase => {
  const found = guided.find((evalCase) => evalCase.name === name);
  if (found === undefined) throw new Error(`no case with guidance named ${name}`);
  return found;
};

describe.each(guided.map((evalCase) => [evalCase.name, evalCase] as const))(
  "case %s, through the pipeline",
  (_, evalCase) => {
    it("meets every guidance target when the answer is marked as its labels ask", async () => {
      const analysis = await answered(evalCase, askedMarks(evalCase));
      const score = scoreCase(analysis, evalCase.labels, verdictFor(evalCase, analysis));
      expect(score.guidanceFollowed.hit).toBe(score.guidanceFollowed.total);
      expect(score.leftOutRight.hit).toBe(score.leftOutRight.total);
      expect(score.guidanceWrong.hit).toBe(0);
      expect(score.guidanceWrong.total).toBeGreaterThan(0);
      expect(rate(score.findingRecall)).toBe(1);
    });

    it("misses them when the answer carries no mark", async () => {
      const analysis = await answered(evalCase, new Map());
      const score = scoreCase(analysis, evalCase.labels, verdictFor(evalCase, analysis));
      expect(score.guidanceWrong.total).toBe(0);
      expect(
        score.guidanceFollowed.hit < score.guidanceFollowed.total ||
          score.leftOutRight.hit < score.leftOutRight.total,
      ).toBe(true);
    });
  },
);

it("fails preference-dont-flag when the Don't flag preference swallows the bug", async () => {
  const evalCase = named("preference-dont-flag");
  const swallowed = new Map(askedMarks(evalCase)).set(0, { ref: "p2", effect: "left-out" });
  const analysis = await answered(evalCase, swallowed);
  const score = scoreCase(analysis, evalCase.labels, verdictFor(evalCase, analysis));
  expect(score.leftOutRight).toEqual({ hit: 1, total: 2 });
  expect(score.guidanceWrong).toEqual({ hit: 1, total: 2 });
  expect(score.findingRecall).toEqual({ hit: 0, total: 1 });
});

it("counts a mark of the preference that matches nothing in preference-dont-flag as wrong", async () => {
  const evalCase = named("preference-dont-flag");
  const stray = new Map(askedMarks(evalCase)).set(2, { ref: "p1", effect: "raised" });
  const analysis = await answered(evalCase, stray);
  const score = scoreCase(analysis, evalCase.labels, verdictFor(evalCase, analysis));
  expect(score.guidanceWrong).toEqual({ hit: 1, total: 2 });
});
