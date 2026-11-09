import { describe, expect, it } from "vitest";
import type { PartId } from "../../../../src/domain/diff/index.ts";
import { type Analysis, DecisionId } from "../../../../src/domain/review/index.ts";
import { fixtureAnalysisView, fixtureHunks, fixtureParts } from "../../../dev/fixtures/index.ts";
import {
  BAR_MAX_PX,
  BAR_MIN_PX,
  barHeight,
  byFile,
  callerFiles,
  callsByLine,
  decisionPlaces,
  fileGroups,
  gapBetween,
  mapSections,
  mechanicalCount,
  parseLayout,
  partIndex,
  partsInPathOrder,
  reviewOrder,
  riskTotals,
  tourSteps,
  trailingProofs,
  withMechanicalInPlace,
} from "./model.ts";
import { formatCost, formatTokens } from "./UsageFooter.tsx";

const analysis = fixtureAnalysisView.analysis;
const h = fixtureHunks;
const p = fixtureParts;

describe("partIndex", () => {
  it("pairs each hunk with its file and risk, in the order asked", () => {
    const items = partIndex(analysis).items([p.cache, h.dependency]);
    expect(items.map((item) => [item.file.path, item.risk.riskClass])).toEqual([
      ["src/services/receipts.ts", "logic"],
      ["package.json", "contract"],
    ]);
  });

  it("reads a hunk the risk pass hasn't classified yet as logic, never mechanical", () => {
    const early: Analysis = { ...analysis, risk: [] };
    const [item] = partIndex(early).items([h.receiptRoute]);
    expect(item?.risk).toEqual({
      hunkId: h.receiptRoute,
      riskClass: "logic",
      reason: "Not classified yet.",
      source: "fallback",
    });
  });

  it("skips IDs it doesn't know", () => {
    expect(partIndex({ ...analysis, files: [] }).items([h.dependency])).toEqual([]);
  });
});

describe("tourSteps", () => {
  it("is the tour when it covers every non-mechanical hunk", () => {
    expect(tourSteps(analysis, partIndex(analysis))).toBe(analysis.tour?.steps);
  });

  it("adds a step for non-mechanical hunks the tour misses, so none goes unshown", () => {
    const steps = analysis.tour?.steps ?? [];
    const partial: Analysis = {
      ...analysis,
      tour: { steps: steps.slice(0, 2), builtBy: "model" },
    };
    const result = tourSteps(partial, partIndex(partial));
    expect(result).toHaveLength(3);
    expect(result[2]).toMatchObject({
      id: "s3",
      title: "Changes the tour left out",
      partIds: [h.dependency, h.receiptFormatting],
    });
  });
});

describe("reading order", () => {
  it("lists non-mechanical hunks by path", () => {
    expect(partsInPathOrder(analysis, partIndex(analysis))).toEqual([
      h.dependency,
      h.routeImports,
      h.receiptRoute,
      h.receiptFormatting,
      p.retry,
      p.cache,
    ]);
  });
});

describe("mapSections and reviewOrder", () => {
  const index = partIndex(analysis);
  const steps = tourSteps(analysis, index);

  it("is the tour's steps, with mechanical hunks in place", () => {
    const sections = mapSections(analysis, steps, index);
    expect(sections.map((section) => section.kind)).toEqual(["step", "step", "step", "step"]);
    // A file's parts are together, in the file's order: the route's imports come first.
    expect(sections[0]?.partIds).toEqual([
      h.routeImports,
      h.receiptRoute,
      h.formatMoneyRemoved,
      p.cache,
    ]);
  });

  it("is every change by path before the tour exists", () => {
    const early: Analysis = { ...analysis, tour: null };
    const sections = mapSections(early, tourSteps(early, index), index);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.kind).toBe("files");
    expect(sections[0]?.partIds).toContain(h.formatMoneyRemoved);
  });

  it("lists the hunks to review in the map's order, without mechanical ones", () => {
    expect(reviewOrder(mapSections(analysis, steps, index), index)).toEqual(
      steps.flatMap((step) => byFile(step.partIds, index)),
    );
  });
});

describe("byFile, fileGroups and gapBetween", () => {
  const index = partIndex(analysis);

  it("puts a step's parts from one file together, in the file's order, files as first reached", () => {
    expect(byFile([h.receiptRoute, p.cache, h.routeImports], index)).toEqual([
      h.routeImports,
      h.receiptRoute,
      p.cache,
    ]);
  });

  it("groups consecutive parts from one file, leaving out parts it doesn't know", () => {
    const unknown = "h_0000000000000000" as PartId;
    const groups = fileGroups([h.routeImports, h.receiptRoute, unknown, p.cache], index);
    expect(groups.map((group) => [group.file.path, group.partIds])).toEqual([
      ["src/routes/orders.ts", [h.routeImports, h.receiptRoute]],
      ["src/services/receipts.ts", [p.cache]],
    ]);
  });

  it("counts the lines between two parts of a file, and the parts read elsewhere among them", () => {
    // The imports are lines 1–8 and the route starts at line 10.
    expect(gapBetween(h.routeImports, h.receiptRoute, index)).toEqual({ lines: 1, parts: [] });
    expect(gapBetween(h.routeImports, h.formatMoneyRemoved, index)?.parts).toEqual([
      h.receiptRoute,
    ]);
    expect(gapBetween(h.routeImports, p.cache, index)).toBeNull();
  });
});

describe("a split part's risk", () => {
  // The cache part is the second of its hunk; the rules see "cachedReceipt" there, no credentials.
  const ruled = (reason: string): Analysis => ({
    ...analysis,
    risk: analysis.risk.map((risk) =>
      risk.hunkId === h.retryAndCache
        ? { ...risk, riskClass: "contract" as const, reason, source: "rule" as const }
        : risk,
    ),
  });

  it("is the rules' on its own lines, when the rules made its hunk's", () => {
    const [cache] = partIndex(ruled("changes credential storage (save_token)")).items([p.cache]);
    expect(cache?.risk).toMatchObject({
      riskClass: "logic",
      reason: "No contract rule matches this part's lines.",
    });
  });

  it("is the hunk's when the model made it", () => {
    const modelled: Analysis = {
      ...analysis,
      risk: analysis.risk.map((risk) =>
        risk.hunkId === h.retryAndCache
          ? {
              ...risk,
              riskClass: "contract" as const,
              reason: "Whole hunk.",
              source: "model" as const,
            }
          : risk,
      ),
    };
    expect(partIndex(modelled).items([p.cache])[0]?.risk.reason).toBe("Whole hunk.");
  });

  it("counts a hunk contract in the totals only when one of its parts is", () => {
    const index = partIndex(ruled("changes credential storage (save_token)"));
    expect(riskTotals(ruled("x"), index).contract).toBe(
      riskTotals(analysis, partIndex(analysis)).contract,
    );
  });
});

describe("decisionPlaces", () => {
  const index = partIndex(analysis);
  const order = mapSections(analysis, tourSteps(analysis, index), index).flatMap(
    (section) => section.partIds,
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
    // The card goes on the split hunk's first part on the page, and its other part links to it.
    expect(places.cards.get(p.cache)).toEqual([moved]);
    expect(places.mentions.get(p.retry)).toEqual([moved]);
    expect(places.mentions.get(h.formatMoneyRemoved)).toBeUndefined();
    expect(places.unplaced).toEqual([nowhere]);
  });
});

describe("callsByLine", () => {
  const index = partIndex(analysis);

  it("puts each call on its line, and drops calls to unknown hunks", () => {
    const calls = callsByLine(analysis.callGraph, index);
    expect(calls.get(h.receiptRoute)?.get(20)).toEqual([
      { symbol: "cachedReceipt", toPartId: p.cache, line: 20 },
    ]);
    expect(callsByLine(analysis.callGraph, partIndex({ ...analysis, files: [] })).size).toBe(0);
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
  const index = partIndex(analysis);

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
    expect(withMechanicalInPlace([h.receiptRoute], partIndex(proved))).toEqual([
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
  const index = partIndex(analysis);

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
  const index = partIndex(analysis);
  const call = (fromPartId: PartId, toPartId: PartId) => ({
    fromPartId,
    toPartId,
    symbol: "s",
    line: 1,
    use: "call" as const,
  });

  it("gives one link per calling file, to its first hunk in the map's order", () => {
    const hints = [call(h.receiptRoute, p.cache), call(h.routeImports, p.cache)];
    expect(callerFiles(hints, index, [h.routeImports, h.receiptRoute]).get(p.cache)).toEqual([
      { path: "src/routes/orders.ts", partId: h.routeImports, test: false },
    ]);
    expect(callerFiles(hints, index, [h.receiptRoute, h.routeImports]).get(p.cache)).toEqual([
      { path: "src/routes/orders.ts", partId: h.receiptRoute, test: false },
    ]);
  });

  it("puts production files first, then tests, each in the map's order", () => {
    const withTest = {
      ...analysis,
      files: analysis.files.map((file) =>
        file.path === "src/lib/money.ts" ? { ...file, path: "src/lib/money.test.ts" } : file,
      ),
    };
    const hints = [call(h.formatMoneyAdded, p.cache), call(h.receiptRoute, p.cache)];
    const order = [h.formatMoneyAdded, h.receiptRoute];
    expect(
      callerFiles(hints, partIndex(withTest), order)
        .get(p.cache)
        ?.map((caller) => [caller.path, caller.test]),
    ).toEqual([
      ["src/routes/orders.ts", false],
      ["src/lib/money.test.ts", true],
    ]);
  });

  it("drops hints to or from hunks the page doesn't know, and a hunk calling itself", () => {
    const empty = partIndex({ ...analysis, files: [] });
    expect(callerFiles([call(h.receiptRoute, h.retryAndCache)], empty, []).size).toBe(0);
    expect(callerFiles([call(h.receiptRoute, h.receiptRoute)], index, []).size).toBe(0);
  });
});
