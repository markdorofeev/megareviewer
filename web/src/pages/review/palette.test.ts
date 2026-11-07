import { describe, expect, it } from "vitest";
import type { Analysis } from "../../../../src/domain/review/index.ts";
import { fixtureAnalysisView, fixtureHunks, fixtureParts } from "../../../dev/fixtures/index.ts";
import { partIndex, tourSteps } from "./model.ts";
import { paletteItems, searchPalette } from "./palette.ts";

const analysis = fixtureAnalysisView.analysis;
const h = fixtureHunks;
const index = partIndex(analysis);
const items = paletteItems(analysis, tourSteps(analysis, index), index);

const search = (query: string) =>
  searchPalette(items, query).map(({ group, items: found }) => [
    group,
    found.map((item) => item.label),
  ]);

describe("the jump palette", () => {
  it("lists every group with nothing typed", () => {
    expect(search("").map(([group]) => group)).toEqual([
      "decisions",
      "mismatches",
      "contract",
      "symbols",
      "steps",
      "files",
    ]);
  });

  it("keeps the items with every typed word, in each group", () => {
    expect(search("receipt cache")).toEqual([
      ["decisions", ["Caches rendered receipts in memory with no size limit or expiry"]],
      ["symbols", ["cachedReceipt"]],
    ]);
    expect(search("ORDERS")).toEqual(expect.arrayContaining([["files", ["src/routes/orders.ts"]]]));
    expect(search("tax retr")).toEqual([
      ["decisions", ["Retries the tax service 3 times with no backoff"]],
      ["steps", ["Retrying the tax service"]],
    ]);
    expect(search("nothing matches this")).toEqual([]);
  });

  it("limits the search to findings with !, symbols with @ and files with /", () => {
    expect(search("!").map(([group]) => group)).toEqual(["decisions", "mismatches", "contract"]);
    expect(search("@")).toEqual([["symbols", ["cachedReceipt", "formatMoney"]]]);
    expect(search("@ money")).toEqual([["symbols", ["formatMoney"]]]);
    expect(search("/ lib")).toEqual([["files", ["src/lib/dates.ts", "src/lib/money.ts"]]]);
    expect(search("!endpoint").map(([group]) => group)).toEqual([
      "decisions",
      "mismatches",
      "contract",
    ]);
  });

  it("goes to each item's place", () => {
    const target = (label: string) => items.find((item) => item.label === label)?.target;
    expect(target("cachedReceipt")).toEqual({ kind: "hunk", partId: fixtureParts.cache });
    expect(target("src/lib/dates.ts")).toEqual({ kind: "mechanical" });
    expect(target("src/routes/orders.ts")).toEqual({ kind: "hunk", partId: h.routeImports });
    expect(target("The receipt endpoint")).toEqual({ kind: "step", stepId: "s1" });
  });

  it("has no decisions, mismatches or symbols without the model and the hints", () => {
    const bare: Analysis = { ...analysis, decisions: [], intent: null, callGraph: [] };
    const groups = searchPalette(paletteItems(bare, [], index), "").map(({ group }) => group);
    expect(groups).toEqual(["contract", "files"]);
  });
});
