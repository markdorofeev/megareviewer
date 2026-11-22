import { describe, expect, it } from "vitest";
import {
  type Analysis,
  type PointLines,
  pointsOf,
  type Step,
  StepId,
} from "../../../../src/domain/review/index.ts";
import { fixtureHunks, tourAnalysisView } from "../../../dev/fixtures/index.ts";
import { fileOverview } from "./overview.ts";
import { depthText, noTourOf, rowsOf, tourOf } from "./tour.ts";

const analysis = tourAnalysisView.analysis;
const overview = fileOverview(analysis);
const points = pointsOf(analysis);

const view = (changes: Partial<Analysis> = {}) => {
  const tour = tourOf({ ...analysis, ...changes }, overview, points);
  if (tour === null) throw new Error("no tour");
  return tour;
};

const ledgerLines = (tour: ReturnType<typeof view>) =>
  tour.ledger.flatMap((group) => group.files).reduce((sum, f) => sum + f.added + f.deleted, 0);

const prLines = analysis.files.reduce((sum, file) => sum + file.additions + file.deletions, 0);

const step = (n: number, ...excerpts: PointLines[]): Step => ({
  id: StepId.parse(`t${n}`),
  sentence: `Step ${n}`,
  excerpts,
});

describe("tourOf", () => {
  it("counts every changed line once: the steps' and the ledger's are the pull request's", () => {
    const tour = view();
    expect(tour.total).toBe(prLines);
    expect(tour.shown + ledgerLines(tour)).toBe(prLines);
  });

  it("holds the count when steps overlap, show removed lines, or a hunk's lines twice", () => {
    const tour = view({
      steps: [
        step(1, { hunkId: fixtureHunks.retryAndCache, side: "new", startLine: 29, line: 45 }),
        step(2, { hunkId: fixtureHunks.retryAndCache, side: "new", startLine: 41, line: 50 }),
        step(3, { hunkId: fixtureHunks.formatMoneyRemoved, side: "old", startLine: 21, line: 24 }),
      ],
    });
    expect(tour.steps[2]?.excerpts[0]?.shown).toBe(4);
    expect(tour.shown + ledgerLines(tour)).toBe(prLines);
  });

  it("says how many of a file's changed lines an excerpt shows", () => {
    const [route] = view().steps;
    expect(route?.excerpts[0]).toMatchObject({
      path: "src/routes/orders.ts",
      shown: 8,
      fileChanged: 18,
    });
  });

  it("groups what the steps didn't show: their files' rest, tests, generated, other", () => {
    const groups = view().ledger.map((group) => [group.id, group.files.map((file) => file.path)]);
    expect(groups).toEqual([
      ["steps", ["src/routes/orders.ts", "src/services/receipts.ts"]],
      ["generated", ["pnpm-lock.yaml", "src/config/defaults.ts", "src/lib/money.ts"]],
      ["other", ["package.json", "src/lib/dates.ts"]],
    ]);
  });

  it("follows the steps on the strip: steps one after another in a directory share a box", () => {
    const tour = view();
    expect(tour.boxes.map((box) => [box.label, box.steps])).toEqual([
      ["src/routes/", [1]],
      ["src/services/", [2, 3, 4]],
    ]);
    expect(tour.others.map((box) => box.label)).not.toContain("src/routes/");
    expect(tour.spans).toEqual([]);
  });

  it("gives a directory the tour comes back to a box of its own, so the numbers only rise", () => {
    const tour = view({
      steps: [
        step(1, { hunkId: fixtureHunks.receiptRoute, side: "new", startLine: 14, line: 17 }),
        step(2, { hunkId: fixtureHunks.retryAndCache, side: "new", startLine: 41, line: 50 }),
        step(3, { hunkId: fixtureHunks.receiptRoute, side: "new", startLine: 18, line: 21 }),
        step(4, { hunkId: fixtureHunks.retryAndCache, side: "new", startLine: 29, line: 39 }),
        step(5, { hunkId: fixtureHunks.receiptFormatting, side: "new", startLine: 3, line: 13 }),
      ],
    });
    expect(tour.boxes.map((box) => [box.label, box.steps])).toEqual([
      ["src/routes/", [1]],
      ["src/services/", [2]],
      ["src/routes/", [3]],
      ["src/services/", [4, 5]],
    ]);
    expect(new Set(tour.boxes.map((box) => box.key)).size).toBe(4);
    expect(tour.boxes.flatMap((box) => box.steps)).toEqual([1, 2, 3, 4, 5]);
    // A directory on the tour twice is still on it once: never among the others.
    expect(tour.others.map((box) => box.label)).not.toContain("src/services/");
  });

  it("groups the two boxes of a step that crosses into another process, apart from its neighbors", () => {
    const tour = view({
      steps: [
        step(1, { hunkId: fixtureHunks.receiptRoute, side: "new", startLine: 14, line: 17 }),
        step(
          2,
          { hunkId: fixtureHunks.receiptRoute, side: "new", startLine: 18, line: 21 },
          { hunkId: fixtureHunks.retryAndCache, side: "new", startLine: 41, line: 50 },
        ),
        step(3, { hunkId: fixtureHunks.retryAndCache, side: "new", startLine: 29, line: 39 }),
      ],
    });
    expect(tour.steps[1]?.boxes).toHaveLength(2);
    expect(tour.boxes.map((box) => [box.label, box.steps])).toEqual([
      ["src/routes/", [1]],
      ["src/routes/", [2]],
      ["src/services/", [2]],
      ["src/services/", [3]],
    ]);
    const [, from, to] = tour.boxes;
    expect(tour.spans).toEqual([{ step: 2, keys: [from?.key, to?.key] }]);
  });

  it("chips the points on a step's lines, findings first, decisions too", () => {
    const [route, cache] = view().steps;
    expect(route?.points.map((point) => [point.kind, point.id])).toEqual(
      expect.arrayContaining([
        ["finding", "f1"],
        ["decision", "d1"],
      ]),
    );
    expect(route?.points[0]?.kind).toBe("finding");
    expect(cache?.points.map((point) => point.id)).toContain("f2");
  });

  it("lists the findings and risks outside the steps, never decisions", () => {
    const tour = view();
    const chipped = new Set(tour.steps.flatMap((one) => one.points.map((point) => point.id)));
    expect(tour.outside.every((point) => point.kind !== "decision")).toBe(true);
    expect(tour.outside.every((point) => !chipped.has(point.id))).toBe(true);
  });

  it("suggests reading the steps with an open finding or an unchecked risk", () => {
    const tour = view();
    expect(tour.depth.read).toEqual([1, 2, 3]);
    const dismissed = tourOf(analysis, overview, points, (point) =>
      point.kind === "finding" ? "dismissed" : "open",
    );
    expect(dismissed?.depth.read).not.toContain(3);
  });

  it("is no tour under three steps", () => {
    expect(
      tourOf({ ...analysis, steps: analysis.steps?.slice(0, 2) ?? [] }, overview, points),
    ).toBeNull();
    expect(tourOf({ ...analysis, steps: null }, overview, points)).toBeNull();
  });
});

describe("rowsOf", () => {
  it("takes the rows from the first line to the last, the other side's between them too", () => {
    const hunk = analysis.files
      .flatMap((file) => file.hunks)
      .find((one) => one.id === fixtureHunks.receiptFormatting);
    if (hunk === undefined) throw new Error("no hunk");
    expect(rowsOf(hunk, { side: "new", startLine: 3, line: 13 })).toEqual({ start: 2, end: 15 });
    expect(rowsOf(hunk, { side: "new", startLine: 90, line: 99 })).toBeNull();
  });
});

describe("noTourOf", () => {
  const ran = analysis;
  it("says why there's no tour", () => {
    const skipped = { ...ran.stages, steps: "skipped" as const };
    expect(noTourOf({ ...ran, stages: skipped, usage: [] })).toEqual({
      kind: "without-tour",
    });
    const none = {
      ...ran,
      stages: {
        ...skipped,
        intent: "skipped" as const,
        findings: "skipped" as const,
        risk: "skipped" as const,
        decisions: "skipped" as const,
      },
      usage: [],
    };
    expect(noTourOf(none)).toEqual({ kind: "no-review" });
    expect(noTourOf({ ...ran, stages: { ...ran.stages, steps: "running" } })).toEqual({
      kind: "writing",
    });
    expect(noTourOf({ ...ran, steps: [] })).toEqual({ kind: "too-small" });
    expect(
      noTourOf({
        ...ran,
        stages: { ...ran.stages, steps: "failed" },
        stepsError: { stage: "steps", code: "model-error", message: "Overloaded" },
      }),
    ).toEqual({ kind: "failed", message: "Overloaded" });
    expect(noTourOf(ran)).toBeNull();
  });
});

describe("depthText", () => {
  const depth = (read: number[], findingsOutside: number, risksOutside: number) =>
    depthText({ read, findingsOutside, risksOutside });

  it("names the steps to read, and leaves a zero count out", () => {
    expect(depth([1, 2, 3], 0, 1)).toBe(
      "Read steps 1, 2 and 3 in the code: each has an open finding or a risk no test checks. 1 risk is outside the steps.",
    );
    expect(depth([2], 2, 0)).toBe(
      "Read step 2 in the code: it has an open finding or a risk no test checks. 2 findings are outside the steps.",
    );
    expect(depth([], 1, 2)).toBe(
      "No step has an open finding or a risk no test checks. 1 finding and 2 risks are outside the steps.",
    );
  });

  it("says nothing of outside the steps when nothing is", () => {
    expect(depth([1], 0, 0)).toBe(
      "Read step 1 in the code: it has an open finding or a risk no test checks.",
    );
  });
});
