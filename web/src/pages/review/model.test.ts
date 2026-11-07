import { describe, expect, it } from "vitest";
import { type Analysis, DecisionId } from "../../../../src/domain/review/index.ts";
import { fixtureAnalysisView, fixtureHunks } from "../../../dev/fixtures/index.ts";
import {
  BAR_MAX_PX,
  BAR_MIN_PX,
  barHeight,
  callerFiles,
  callsByLine,
  decisionPlaces,
  hunkIndex,
  hunksInPathOrder,
  mapSections,
  mechanicalCount,
  parseLayout,
  reviewOrder,
  riskTotals,
  tourSteps,
  trailingProofs,
  withMechanicalInPlace,
} from "./model.ts";
import { formatCost, formatTokens } from "./UsageFooter.tsx";

const analysis = fixtureAnalysisView.analysis;
const h = fixtureHunks;

describe("hunkIndex", () => {
  it("pairs each hunk with its file and risk, in the order asked", () => {
    const items = hunkIndex(analysis).items([h.retryAndCache, h.dependency]);
    expect(items.map((item) => [item.file.path, item.risk.riskClass])).toEqual([
      ["src/services/receipts.ts", "logic"],
      ["package.json", "contract"],
    ]);
  });

  it("reads a hunk the risk pass hasn't classified yet as logic, never mechanical", () => {
    const early: Analysis = { ...analysis, risk: [] };
    const [item] = hunkIndex(early).items([h.receiptRoute]);
    expect(item?.risk).toEqual({
      hunkId: h.receiptRoute,
      riskClass: "logic",
      reason: "Not classified yet.",
      source: "fallback",
    });
  });

  it("skips IDs it doesn't know", () => {
    expect(hunkIndex({ ...analysis, files: [] }).items([h.dependency])).toEqual([]);
  });
});

describe("tourSteps", () => {
  it("is the tour when it covers every non-mechanical hunk", () => {
    expect(tourSteps(analysis, hunkIndex(analysis))).toBe(analysis.tour?.steps);
  });

  it("adds a step for non-mechanical hunks the tour misses, so none goes unshown", () => {
    const steps = analysis.tour?.steps ?? [];
    const partial: Analysis = {
      ...analysis,
      tour: { steps: steps.slice(0, 2), builtBy: "model" },
    };
    const result = tourSteps(partial, hunkIndex(partial));
    expect(result).toHaveLength(3);
    expect(result[2]).toMatchObject({
      id: "s3",
      title: "Changes the tour left out",
      hunkIds: [h.dependency, h.receiptFormatting],
    });
  });
});

describe("reading order", () => {
  it("lists non-mechanical hunks by path", () => {
    expect(hunksInPathOrder(analysis, hunkIndex(analysis))).toEqual([
      h.dependency,
      h.routeImports,
      h.receiptRoute,
      h.receiptFormatting,
      h.retryAndCache,
    ]);
  });
});

describe("mapSections and reviewOrder", () => {
  const index = hunkIndex(analysis);
  const steps = tourSteps(analysis, index);

  it("is the tour's steps, with mechanical hunks in place", () => {
    const sections = mapSections(analysis, steps, index);
    expect(sections.map((section) => section.kind)).toEqual(["step", "step", "step", "step"]);
    expect(sections[0]?.hunkIds).toEqual([h.receiptRoute, h.routeImports, h.formatMoneyRemoved]);
  });

  it("is every change by path before the tour exists", () => {
    const early: Analysis = { ...analysis, tour: null };
    const sections = mapSections(early, tourSteps(early, index), index);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.kind).toBe("files");
    expect(sections[0]?.hunkIds).toContain(h.formatMoneyRemoved);
  });

  it("lists the hunks to review in the map's order, without mechanical ones", () => {
    expect(reviewOrder(mapSections(analysis, steps, index), index)).toEqual(
      steps.flatMap((step) => step.hunkIds),
    );
  });
});

describe("decisionPlaces", () => {
  const index = hunkIndex(analysis);
  const order = mapSections(analysis, tourSteps(analysis, index), index).flatMap(
    (section) => section.hunkIds,
  );
  const decision = (id: string, hunkIds: readonly (typeof h)[keyof typeof h][]) => ({
    ...analysis.decisions[0],
    id: DecisionId.parse(id),
    title: id,
    category: "other" as const,
    whyItMatters: "w",
    hunkIds,
  });

  it("puts each card on the decision's first hunk in the page's order, and links the others", () => {
    const d5 = decision("d5", [h.dependency, h.receiptFormatting]);
    const places = decisionPlaces([d5], order, index);
    expect(places.cards.get(h.receiptFormatting)).toEqual([d5]);
    expect(places.mentions.get(h.dependency)).toEqual([d5]);
    expect(places.cardHunk.get(d5.id)).toBe(h.receiptFormatting);
    expect(places.unplaced).toEqual([]);
  });

  it("never puts a card on a mechanical hunk, and keeps decisions on none apart", () => {
    const moved = decision("d1", [h.formatMoneyRemoved, h.retryAndCache]);
    const nowhere = decision("d2", [h.formatMoneyAdded]);
    const places = decisionPlaces([moved, nowhere], order, index);
    expect(places.cards.get(h.retryAndCache)).toEqual([moved]);
    expect(places.mentions.get(h.formatMoneyRemoved)).toBeUndefined();
    expect(places.unplaced).toEqual([nowhere]);
  });
});

describe("callsByLine", () => {
  const index = hunkIndex(analysis);

  it("puts each call on its line, and drops calls to unknown hunks", () => {
    const calls = callsByLine(analysis.callGraph, index);
    expect(calls.get(h.receiptRoute)?.get(20)).toEqual([
      { symbol: "cachedReceipt", toHunkId: h.retryAndCache, line: 20 },
    ]);
    expect(callsByLine(analysis.callGraph, hunkIndex({ ...analysis, files: [] })).size).toBe(0);
  });
});

describe("parseLayout", () => {
  it("reads a stored call tree as the overview that replaced it", () => {
    expect(parseLayout("tree")).toBe("overview");
    expect(parseLayout("overview")).toBe("overview");
    expect(parseLayout("map")).toBe("map");
    expect(parseLayout("graph")).toBeUndefined();
  });
});

describe("mechanicalCount", () => {
  it("counts mechanical hunks and file-level proofs, as the mechanical group lists them", () => {
    expect(mechanicalCount(analysis.proofs)).toBe(6);
    expect(mechanicalCount([])).toBe(0);
  });
});

describe("usage formatting", () => {
  it("rounds token counts and shows dollars to the cent", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(182_400)).toBe("182k");
    expect(formatTokens(2_350_000)).toBe("2.4M");
    expect(formatCost(0.9349)).toBe("$0.93");
  });
});

describe("withMechanicalInPlace", () => {
  const index = hunkIndex(analysis);

  it("puts a file's later mechanical hunk after the step's last hunk from that file", () => {
    expect(withMechanicalInPlace([h.receiptRoute, h.retryAndCache], index)).toEqual([
      h.receiptRoute,
      h.formatMoneyRemoved,
      h.retryAndCache,
    ]);
  });

  it("puts an earlier mechanical hunk before the step's first hunk from that file", () => {
    const proved: Analysis = {
      ...analysis,
      proofs: [
        ...analysis.proofs,
        { path: "src/routes/orders.ts", hunkId: h.routeImports, kind: "whitespace", detail: "w" },
      ],
    };
    expect(withMechanicalInPlace([h.receiptRoute], hunkIndex(proved))).toEqual([
      h.routeImports,
      h.receiptRoute,
      h.formatMoneyRemoved,
    ]);
  });

  it("adds nothing for files without mechanical hunks, and places each hunk once", () => {
    expect(withMechanicalInPlace([h.dependency], index)).toEqual([h.dependency]);
    expect(withMechanicalInPlace([h.routeImports, h.receiptRoute], index)).toEqual([
      h.routeImports,
      h.receiptRoute,
      h.formatMoneyRemoved,
    ]);
  });
});

describe("risk counts", () => {
  const index = hunkIndex(analysis);

  it("sizes a hunk's bar by its lines, within a minimum and a cap", () => {
    const lines = (count: number) => ({ lines: Array.from({ length: count }, () => line) });
    const line = {
      kind: "add" as const,
      text: "",
      oldLine: null,
      newLine: 1,
      noNewlineAtEnd: false,
    };
    expect(barHeight(lines(1))).toBe(BAR_MIN_PX);
    expect(barHeight(lines(30))).toBe(30);
    expect(barHeight(lines(500))).toBe(BAR_MAX_PX);
  });

  it("counts every hunk and file-level proof once across the pull request", () => {
    const totals = riskTotals(analysis, index);
    const hunks = analysis.files.flatMap((file) => file.hunks).length;
    const fileLevel = analysis.proofs.filter((proof) => proof.hunkId === null).length;
    expect(totals.contract + totals.logic + totals.mechanical).toBe(hunks + fileLevel);
    expect(totals.mechanical).toBe(mechanicalCount(analysis.proofs));
  });

  it("leaves mechanical hunks of files with other changes out of the mechanical group", () => {
    const trailing = trailingProofs(analysis, index);
    expect(trailing.some((proof) => proof.hunkId === h.formatMoneyRemoved)).toBe(false);
    expect(trailing).toHaveLength(analysis.proofs.length - 1);
  });
});

describe("callerFiles", () => {
  const index = hunkIndex(analysis);
  const call = (fromHunkId: (typeof h)[keyof typeof h], toHunkId: (typeof h)[keyof typeof h]) => ({
    fromHunkId,
    toHunkId,
    symbol: "s",
    line: 1,
    use: "call" as const,
  });

  it("gives one link per calling file, to its first hunk in the map's order", () => {
    const hints = [call(h.receiptRoute, h.retryAndCache), call(h.routeImports, h.retryAndCache)];
    expect(
      callerFiles(hints, index, [h.routeImports, h.receiptRoute]).get(h.retryAndCache),
    ).toEqual([{ path: "src/routes/orders.ts", hunkId: h.routeImports, test: false }]);
    expect(
      callerFiles(hints, index, [h.receiptRoute, h.routeImports]).get(h.retryAndCache),
    ).toEqual([{ path: "src/routes/orders.ts", hunkId: h.receiptRoute, test: false }]);
  });

  it("puts production files first, then tests, each in the map's order", () => {
    const withTest = {
      ...analysis,
      files: analysis.files.map((file) =>
        file.path === "src/lib/money.ts" ? { ...file, path: "src/lib/money.test.ts" } : file,
      ),
    };
    const hints = [
      call(h.formatMoneyAdded, h.retryAndCache),
      call(h.receiptRoute, h.retryAndCache),
    ];
    const order = [h.formatMoneyAdded, h.receiptRoute];
    expect(
      callerFiles(hints, hunkIndex(withTest), order)
        .get(h.retryAndCache)
        ?.map((caller) => [caller.path, caller.test]),
    ).toEqual([
      ["src/routes/orders.ts", false],
      ["src/lib/money.test.ts", true],
    ]);
  });

  it("drops hints to or from hunks the page doesn't know, and a hunk calling itself", () => {
    const empty = hunkIndex({ ...analysis, files: [] });
    expect(callerFiles([call(h.receiptRoute, h.retryAndCache)], empty, []).size).toBe(0);
    expect(callerFiles([call(h.receiptRoute, h.receiptRoute)], index, []).size).toBe(0);
  });
});
