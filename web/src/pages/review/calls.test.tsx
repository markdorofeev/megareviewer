import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { type CallSite, PartId } from "../../../../src/domain/diff/index.ts";
import { fixtureAnalysisView } from "../../../dev/fixtures/index.ts";
import { createCallPeekHandle } from "../../review/index.ts";
import { callMarks, callTriggerId } from "./calls.tsx";
import { partIndex } from "./model.ts";

const analysis = fixtureAnalysisView.analysis;
const index = partIndex(analysis);
const [site] = analysis.callSites;
if (site === undefined) throw new Error("the fixture has call sites");

describe("callMarks", () => {
  it("marks each call on its part's line, over its name", () => {
    const marks = callMarks([site], index, createCallPeekHandle());
    const [mark] = marks.get(site.partId)?.get(site.line) ?? [];
    expect([mark?.start, mark?.end]).toEqual([site.column, site.column + site.length]);
    const { container } = render(mark?.render("cachedReceipt"));
    const trigger = container.querySelector("[data-slot=call]");
    expect([trigger?.id, trigger?.textContent]).toEqual([callTriggerId(site), "cachedReceipt"]);
  });

  it("marks a call once, and nothing where the page doesn't know its parts", () => {
    const unknown = PartId.parse("h_ffffffffffffffff");
    const sites: CallSite[] = [
      site,
      { ...site, symbol: "again" },
      { ...site, column: site.column + 1, toPartIds: [unknown] },
      { ...site, partId: unknown, line: 1 },
    ];
    const marks = callMarks(sites, index, createCallPeekHandle());
    expect([...marks.keys()]).toEqual([site.partId]);
    expect(marks.get(site.partId)?.get(site.line)).toHaveLength(1);
  });
});
