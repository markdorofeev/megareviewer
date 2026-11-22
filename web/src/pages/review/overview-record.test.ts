import { describe, expect, it } from "vitest";
import type { Analysis } from "../../../../src/domain/review/index.ts";
import {
  deepAppAnalysisView,
  fixtureAnalysisView,
  javaServiceAnalysisView,
  largeAnalysisView,
  monorepoAnalysisView,
} from "../../../dev/fixtures/index.ts";
import { throughOf } from "./brief.ts";
import { fileOverview, type OverviewNode } from "./overview.ts";
import recorded from "./overview-record.json" with { type: "json" };

// The overview's rows, labels, entries and order, and the brief's Through line, as they were before
// the code's flows lost the fields of the model's tour pass: a change to what the page shows is a
// change to this record, made on purpose.

const node = ({ key, label, entries, flows, partIds, row }: OverviewNode) => ({
  key,
  label,
  entries,
  flows,
  partIds,
  row,
});

const cases: Readonly<Record<keyof typeof recorded, Analysis>> = {
  fixture: fixtureAnalysisView.analysis,
  large: largeAnalysisView.analysis,
  deep: deepAppAnalysisView.analysis,
  java: javaServiceAnalysisView.analysis,
  mono: monorepoAnalysisView.analysis,
};

describe("the overview", () => {
  it.each(["fixture", "large", "deep", "java", "mono"] as const)("of %s is as recorded", (name) => {
    const overview = fileOverview(cases[name]);
    expect({
      rows: overview.rows.map((row) => row.map(node)),
      strip: overview.strip.map(node),
      through: throughOf(overview),
    }).toEqual(recorded[name]);
  });
});
