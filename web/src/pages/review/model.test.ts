import { describe, expect, it } from "vitest";
import type { Analysis } from "../../../../src/domain/review/index.ts";
import { fixtureAnalysisView, fixtureHunks } from "../../../dev/fixtures/index.ts";
import {
  hunkIndex,
  hunksInPathOrder,
  inReadingOrder,
  mechanicalCount,
  readingOrder,
  tourSteps,
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

  it("sorts a decision's hunks by the tour, then by file", () => {
    const order = readingOrder(analysis, analysis.tour?.steps ?? []);
    expect(inReadingOrder([h.dependency, h.receiptFormatting, h.receiptRoute], order)).toEqual([
      h.receiptRoute,
      h.receiptFormatting,
      h.dependency,
    ]);
    expect(inReadingOrder([h.formatMoneyAdded, h.receiptRoute, h.receiptRoute], order)).toEqual([
      h.receiptRoute,
      h.formatMoneyAdded,
    ]);
  });
});

describe("mechanicalCount", () => {
  it("counts mechanical hunks and file-level proofs, as the mechanical group lists them", () => {
    expect(mechanicalCount(analysis)).toBe(6);
    expect(mechanicalCount({ ...analysis, proofs: [] })).toBe(0);
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
