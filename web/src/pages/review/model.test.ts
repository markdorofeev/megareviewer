import { describe, expect, it } from "vitest";
import type { Analysis } from "../../../../src/domain/review/index.ts";
import { fixtureAnalysisView, fixtureHunks } from "../../../dev/fixtures/index.ts";
import {
  entryOf,
  hunkIndex,
  hunkLinks,
  hunksInPathOrder,
  inReadingOrder,
  mechanicalCount,
  readingOrder,
  reviewOrder,
  riskMix,
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

  it("adds up a step's changed lines by risk class", () => {
    const mix = riskMix([h.dependency, h.receiptRoute, h.formatMoneyRemoved], index);
    expect(mix.contract).toBeGreaterThan(0);
    expect(mix.mechanical).toBeGreaterThan(0);
    expect(riskMix([h.retryAndCache], index)).toMatchObject({ contract: 0, mechanical: 0 });
  });

  it("counts every hunk and file-level proof once across the pull request", () => {
    const totals = riskTotals(analysis, index);
    const hunks = analysis.files.flatMap((file) => file.hunks).length;
    const fileLevel = analysis.proofs.filter((proof) => proof.hunkId === null).length;
    expect(totals.contract + totals.logic + totals.mechanical).toBe(hunks + fileLevel);
    expect(totals.mechanical).toBe(mechanicalCount(analysis.proofs));
  });

  it("leaves mechanical hunks of files with other changes out of the last entry", () => {
    const trailing = trailingProofs(analysis, index);
    expect(trailing.some((proof) => proof.hunkId === h.formatMoneyRemoved)).toBe(false);
    expect(trailing).toHaveLength(analysis.proofs.length - 1);
  });
});

describe("hunkLinks", () => {
  const index = hunkIndex(analysis);

  it("links a caller down to its callee and the callee back up, once per symbol", () => {
    const hints = [...analysis.callGraph, ...analysis.callGraph];
    const links = hunkLinks(hints, index);
    expect(links.get(h.receiptRoute)).toEqual([
      { direction: "calls", symbol: "cachedReceipt", hunkId: h.retryAndCache },
    ]);
    expect(links.get(h.retryAndCache)).toEqual([
      { direction: "called-by", symbol: "cachedReceipt", hunkId: h.receiptRoute },
    ]);
  });

  it("drops hints to unknown hunks and keeps at most six links each way", () => {
    const unknown = { ...analysis.callGraph[0], toHunkId: h.dependency, fromHunkId: h.dependency };
    expect(
      hunkLinks(
        [unknown].map((hint) => ({ ...hint, symbol: "x" })),
        hunkIndex({ ...analysis, files: [] }),
      ).size,
    ).toBe(0);
    const many = Array.from({ length: 9 }, (_, i) => ({
      fromHunkId: h.receiptRoute,
      toHunkId: h.retryAndCache,
      symbol: `s${i}`,
    }));
    expect(hunkLinks(many, index).get(h.receiptRoute)).toHaveLength(6);
  });
});

describe("entryOf and reviewOrder", () => {
  const index = hunkIndex(analysis);
  const steps = tourSteps(analysis, index);

  it("finds the step that shows a hunk, mechanical ones in place included", () => {
    expect(entryOf(h.retryAndCache, steps, index)).toEqual({ kind: "step", stepId: "s2" });
    expect(entryOf(h.formatMoneyRemoved, steps, index)).toEqual({ kind: "step", stepId: "s1" });
    expect(entryOf(h.formatMoneyAdded, steps, index)).toEqual({ kind: "mechanical" });
  });

  it("lists the hunks to review in tour order", () => {
    expect(reviewOrder(steps).map((item) => item.hunkId)).toEqual(
      steps.flatMap((step) => step.hunkIds),
    );
  });
});
