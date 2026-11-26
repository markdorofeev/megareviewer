import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { pointsOf } from "../../../../src/domain/review/index.ts";
import { tourAnalysisView } from "../../../dev/fixtures/index.ts";
import { fileOverview } from "./overview.ts";
import { type TourView, tourOf } from "./tour.ts";
import { Understand } from "./Understand.tsx";

const analysis = tourAnalysisView.analysis;
const fixtureTour = tourOf(analysis, fileOverview(analysis), pointsOf(analysis));

const draw = (changes: Partial<TourView> = {}) => {
  if (fixtureTour === null) throw new Error("no tour");
  render(
    <Understand
      tour={{ ...fixtureTour, ...changes }}
      stateOf={() => "open"}
      renderExcerpt={() => null}
      onOpenPoint={() => {}}
      onOpenFile={() => {}}
      onOpenInCode={() => {}}
    />,
  );
  return within(screen.getByRole("region", { name: "Tour steps" }));
};

describe("what the tour didn't show", () => {
  it("is a section of its own, its parts headed at the steps' level", () => {
    const steps = draw({ outside: pointsOf(analysis).slice(0, 1) });
    const end = within(steps.getByRole("region", { name: "After the tour" }));
    expect(end.getAllByRole("heading", { level: 2 }).map((one) => one.textContent)).toEqual([
      "Not in the tour · 7 files",
      "Findings outside the steps",
    ]);
  });

  it("isn't drawn when every line is on a step and every finding on one too", () => {
    const steps = draw({ ledger: [], outside: [] });
    expect(steps.queryByRole("region", { name: "After the tour" })).toBeNull();
  });
});
