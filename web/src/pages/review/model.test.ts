import { describe, expect, it } from "vitest";
import { type Analysis, type Point, PointId } from "../../../../src/domain/review/index.ts";
import { fixtureAnalysisView, fixtureHunks, fixtureParts } from "../../../dev/fixtures/index.ts";
import {
  byTreePath,
  gapBetween,
  mapFiles,
  mechanicalCount,
  parseLayout,
  partIndex,
  partsInPathOrder,
  pointPlaces,
  tourSteps,
  trailingProofs,
} from "./model.ts";
import { formatCost, formatTokens, formatTotalCost } from "./UsageFooter.tsx";

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
      partIds: [h.receiptFormatting, h.dependency],
    });
  });
});

describe("reading order", () => {
  it("lists non-mechanical hunks by path, directories first", () => {
    expect(partsInPathOrder(analysis, partIndex(analysis))).toEqual([
      h.routeImports,
      h.receiptRoute,
      h.receiptFormatting,
      p.retry,
      p.cache,
      h.dependency,
    ]);
  });
});

describe("mapFiles", () => {
  const index = partIndex(analysis);

  it("lists the files with a part to review in path order, each with all its parts in order", () => {
    const files = mapFiles(analysis, index);
    const paths = files.map((group) => group.file.path);
    expect(paths).toEqual([...paths].sort(byTreePath));
    const receipts = files.find((group) => group.file.path === "src/services/receipts.ts");
    if (receipts === undefined) throw new Error("no receipts.ts");
    expect(receipts.partIds).toEqual(index.partsInFile(receipts.file));
    // A mechanical part stays in place on its file's card.
    const orders = files.find((group) => group.file.path === "src/routes/orders.ts");
    expect(orders?.partIds).toContain(h.formatMoneyRemoved);
  });

  it("leaves out files with nothing but mechanical changes", () => {
    const files = mapFiles(analysis, index);
    expect(files.every((group) => group.partIds.some((id) => !index.mechanical.has(id)))).toBe(
      true,
    );
  });
});

describe("byTreePath", () => {
  it("lists directories before files at each level, then by name", () => {
    const paths = ["b.ts", "src/z.ts", "README.md", "src/a/b.ts", "a/x.ts", "src/B.ts", "src/a.ts"];
    expect([...paths].sort(byTreePath)).toEqual([
      "a/x.ts",
      "src/a/b.ts",
      "src/a.ts",
      "src/B.ts",
      "src/z.ts",
      "b.ts",
      "README.md",
    ]);
  });
});

describe("gapBetween", () => {
  const index = partIndex(analysis);

  it("counts the unchanged lines between two parts of a file", () => {
    // The imports are lines 1–8 and the route starts at line 10.
    expect(gapBetween(h.routeImports, h.receiptRoute, index)).toBe(1);
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
});

describe("pointPlaces", () => {
  const index = partIndex(analysis);
  const order = mapFiles(analysis, index).flatMap((group) => group.partIds);
  const point = (id: string, hunkIds: readonly (typeof h)[keyof typeof h][]): Point => ({
    id: PointId.parse(id),
    kind: "decision",
    title: id,
    explanation: "w",
    path: null,
    lines: null,
    hunkIds,
  });

  it("puts each card on the point's first hunk in the page's order, and links the others", () => {
    const d5 = point("d5", [h.dependency, h.receiptFormatting]);
    const places = pointPlaces([d5], order, index);
    expect(places.cards.get(h.receiptFormatting)).toEqual([d5]);
    expect(places.mentions.get(h.dependency)).toEqual([d5]);
    expect(places.cardPart.get(d5.id)).toBe(h.receiptFormatting);
    expect(places.unplaced).toEqual([]);
  });

  it("puts a card on the part showing its lines, whatever the page's order", () => {
    const cachePart = index.parts.get(p.cache);
    const line = cachePart?.hunk.lines.find((one) => one.kind === "add")?.newLine;
    if (line == null) throw new Error("the cache part has an added line");
    const onCache: Point = {
      ...point("f1", [h.retryAndCache]),
      kind: "finding",
      lines: { hunkId: h.retryAndCache, side: "new", startLine: line, line },
    };
    const places = pointPlaces([onCache], order, index);
    expect(places.cards.get(p.cache)).toEqual([onCache]);
    expect(places.mentions.get(p.retry)).toEqual([onCache]);
  });

  it("never puts a card on a mechanical hunk, and keeps points on none apart", () => {
    const moved = point("d1", [h.formatMoneyRemoved, h.retryAndCache]);
    const nowhere = point("d2", [h.formatMoneyAdded]);
    const places = pointPlaces([moved, nowhere], order, index);
    // The card goes on the split hunk's first part on the page, and its other part links to it.
    expect(places.cards.get(p.retry)).toEqual([moved]);
    expect(places.mentions.get(p.cache)).toEqual([moved]);
    expect(places.mentions.get(h.formatMoneyRemoved)).toBeUndefined();
    expect(places.unplaced).toEqual([nowhere]);
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

  it("calls a plan's cost an estimate at API prices", () => {
    expect(formatTotalCost(0.9349, false)).toBe("$0.93");
    expect(formatTotalCost(0.9349, true)).toBe("≈ $0.93 at API prices, on your Claude plan");
  });
});

describe("trailingProofs", () => {
  const index = partIndex(analysis);

  it("leaves mechanical hunks of files with other changes out of the mechanical group", () => {
    const trailing = trailingProofs(analysis, index);
    expect(trailing.some((proof) => proof.hunkId === h.formatMoneyRemoved)).toBe(false);
    expect(trailing).toHaveLength(analysis.proofs.length - 1);
  });
});
