import { describe, expect, it } from "vitest";
import {
  type Analysis,
  type PointLines,
  pointsOf,
  type Stop,
  StopId,
} from "../../../../src/domain/review/index.ts";
import { fixtureHunks, tourAnalysisView } from "../../../dev/fixtures/index.ts";
import { fileOverview } from "./overview.ts";
import { depthText, noTourOf, rowsOf, tourOf } from "./tour.ts";

const analysis = tourAnalysisView.analysis;
const overview = fileOverview(analysis, analysis.flows?.steps ?? []);
const points = pointsOf(analysis);

const view = (changes: Partial<Analysis> = {}) => {
  const tour = tourOf({ ...analysis, ...changes }, overview, points);
  if (tour === null) throw new Error("no tour");
  return tour;
};

const ledgerLines = (tour: ReturnType<typeof view>) =>
  tour.ledger.flatMap((group) => group.files).reduce((sum, f) => sum + f.added + f.deleted, 0);

const prLines = analysis.files.reduce((sum, file) => sum + file.additions + file.deletions, 0);

const stop = (n: number, ...excerpts: PointLines[]): Stop => ({
  id: StopId.parse(`t${n}`),
  sentence: `Stop ${n}`,
  excerpts,
});

describe("tourOf", () => {
  it("counts every changed line once: the stops' and the ledger's are the pull request's", () => {
    const tour = view();
    expect(tour.total).toBe(prLines);
    expect(tour.shown + ledgerLines(tour)).toBe(prLines);
  });

  it("holds the count when stops overlap, show removed lines, or a hunk's lines twice", () => {
    const tour = view({
      stops: [
        stop(1, { hunkId: fixtureHunks.retryAndCache, side: "new", startLine: 29, line: 45 }),
        stop(2, { hunkId: fixtureHunks.retryAndCache, side: "new", startLine: 41, line: 50 }),
        stop(3, { hunkId: fixtureHunks.formatMoneyRemoved, side: "old", startLine: 21, line: 24 }),
      ],
    });
    expect(tour.stops[2]?.excerpts[0]?.shown).toBe(4);
    expect(tour.shown + ledgerLines(tour)).toBe(prLines);
  });

  it("says how many of a file's changed lines an excerpt shows", () => {
    const [route] = view().stops;
    expect(route?.excerpts[0]).toMatchObject({
      path: "src/routes/orders.ts",
      shown: 8,
      fileChanged: 18,
    });
  });

  it("groups what the stops didn't show: their files' rest, tests, generated, other", () => {
    const groups = view().ledger.map((group) => [group.id, group.files.map((file) => file.path)]);
    expect(groups).toEqual([
      ["stops", ["src/routes/orders.ts", "src/services/receipts.ts"]],
      ["generated", ["pnpm-lock.yaml", "src/config/defaults.ts", "src/lib/money.ts"]],
      ["other", ["package.json", "src/lib/dates.ts"]],
    ]);
  });

  it("puts each stop's directories on the strip in the order the stops first reach them", () => {
    const tour = view();
    expect(tour.boxes.map((box) => [box.label, box.stops])).toEqual([
      ["src/routes/", [1]],
      ["src/services/", [2, 3, 4]],
    ]);
    expect(tour.others.map((box) => box.label)).not.toContain("src/routes/");
    expect(tour.spans).toEqual([]);
  });

  it("groups the two boxes a stop crossing into another process spans, when they're neighbors", () => {
    const tour = view({
      stops: [
        stop(
          1,
          { hunkId: fixtureHunks.receiptRoute, side: "new", startLine: 14, line: 21 },
          { hunkId: fixtureHunks.retryAndCache, side: "new", startLine: 41, line: 50 },
        ),
        stop(2, { hunkId: fixtureHunks.retryAndCache, side: "new", startLine: 29, line: 39 }),
        stop(3, { hunkId: fixtureHunks.receiptFormatting, side: "new", startLine: 3, line: 13 }),
      ],
    });
    expect(tour.stops[0]?.boxes).toHaveLength(2);
    expect(tour.spans).toEqual([{ stop: 1, keys: ["group:src/routes", "group:src/services"] }]);
  });

  it("chips the points on a stop's lines, findings first, decisions too", () => {
    const [route, cache] = view().stops;
    expect(route?.points.map((point) => [point.kind, point.id])).toEqual(
      expect.arrayContaining([
        ["finding", "f1"],
        ["decision", "d1"],
      ]),
    );
    expect(route?.points[0]?.kind).toBe("finding");
    expect(cache?.points.map((point) => point.id)).toContain("f2");
  });

  it("lists the findings and risks outside the stops, never decisions", () => {
    const tour = view();
    const chipped = new Set(tour.stops.flatMap((one) => one.points.map((point) => point.id)));
    expect(tour.outside.every((point) => point.kind !== "decision")).toBe(true);
    expect(tour.outside.every((point) => !chipped.has(point.id))).toBe(true);
  });

  it("suggests reading the stops with an open finding or an unchecked risk", () => {
    const tour = view();
    expect(tour.depth.read).toEqual([1, 2, 3]);
    const dismissed = tourOf(analysis, overview, points, (point) =>
      point.kind === "finding" ? "dismissed" : "open",
    );
    expect(dismissed?.depth.read).not.toContain(3);
  });

  it("is no tour under three stops", () => {
    expect(
      tourOf({ ...analysis, stops: analysis.stops?.slice(0, 2) ?? [] }, overview, points),
    ).toBeNull();
    expect(tourOf({ ...analysis, stops: null }, overview, points)).toBeNull();
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
    const skipped = { ...ran.stages, stops: "skipped" as const };
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
    expect(noTourOf({ ...ran, stages: { ...ran.stages, stops: "running" } })).toEqual({
      kind: "writing",
    });
    expect(noTourOf({ ...ran, stops: [] })).toEqual({ kind: "too-small" });
    expect(
      noTourOf({
        ...ran,
        stages: { ...ran.stages, stops: "failed" },
        stopsError: { stage: "stops", code: "model-error", message: "Overloaded" },
      }),
    ).toEqual({ kind: "failed", message: "Overloaded" });
    expect(noTourOf(ran)).toBeNull();
  });
});

describe("depthText", () => {
  const depth = (read: number[], findingsOutside: number, risksOutside: number) =>
    depthText({ read, findingsOutside, risksOutside });

  it("names the stops to read, and leaves a zero count out", () => {
    expect(depth([1, 2, 3], 0, 1)).toBe(
      "Read stops 1, 2 and 3 in the code: each has an open finding or a risk no test checks. 1 risk is outside the stops.",
    );
    expect(depth([2], 2, 0)).toBe(
      "Read stop 2 in the code: it has an open finding or a risk no test checks. 2 findings are outside the stops.",
    );
    expect(depth([], 1, 2)).toBe(
      "No stop has an open finding or a risk no test checks. 1 finding and 2 risks are outside the stops.",
    );
  });

  it("says nothing of outside the stops when nothing is", () => {
    expect(depth([1], 0, 0)).toBe(
      "Read stop 1 in the code: it has an open finding or a risk no test checks.",
    );
  });
});
