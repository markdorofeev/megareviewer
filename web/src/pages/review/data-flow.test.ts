import { describe, expect, it } from "vitest";
import type { Analysis } from "../../../../src/domain/review/index.ts";
import {
  fixtureAnalysisView,
  fixtureDataFlow,
  tourAnalysisView,
} from "../../../dev/fixtures/index.ts";
import {
  dataFlowOf,
  type FlowFile,
  familiesOf,
  noDataFlowOf,
  noDataFlowText,
} from "./data-flow.ts";

const analysis = tourAnalysisView.analysis;

const fileNamed = (path: string): FlowFile => ({
  path,
  name: path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, ""),
  status: "new",
  calls: [],
  calledFor: [],
  added: 10,
  deleted: 1,
});

const viewOf = (changes: Partial<Analysis> = {}) => {
  const view = dataFlowOf({ ...analysis, ...changes });
  if (view === null) throw new Error("the fixture has a data flow");
  return view;
};

describe("dataFlowOf", () => {
  it("is null without a flow", () => {
    expect(dataFlowOf(fixtureAnalysisView.analysis)).toBeNull();
  });

  it("draws the stations in order, each with its files and what it hands on", () => {
    const view = viewOf();
    expect(view.source).toBe("`GET /orders/:id/receipt` from the orders page");
    expect(view.end).toBe("the response");
    expect(
      view.stations.map((station) => [
        station.name,
        station.keeps,
        station.families.flatMap((family) => family.files.map((file) => file.name)),
        station.gives,
      ]),
    ).toEqual([
      ["Find the order", false, ["orders"], "the order, or a 404"],
      [
        "Render the receipt, kept in memory",
        true,
        ["receipts", "money"],
        "the receipt as plain text",
      ],
    ]);
  });

  it("tells a file the pull request adds from existing code it edits", () => {
    const files = viewOf().stations.flatMap((station) =>
      station.families.flatMap((family) => family.files),
    );
    expect(files.map((file) => [file.name, file.status])).toEqual([
      ["orders", "changed"],
      ["receipts", "changed"],
      ["money", "new"],
    ]);
  });

  it("counts every changed line once: on the flow, or in what it leaves out", () => {
    const view = viewOf();
    const onFlow = view.stations.reduce((sum, station) => sum + station.added + station.deleted, 0);
    const off = view.off.reduce((sum, group) => sum + group.added + group.deleted, 0);
    const total = analysis.files.reduce(
      (sum, file) =>
        sum +
        file.hunks.reduce(
          (lines, hunk) => lines + hunk.lines.filter((line) => line.kind !== "context").length,
          0,
        ),
      0,
    );
    expect(view.total.added + view.total.deleted).toBe(total);
    expect(view.shown.added + view.shown.deleted).toBe(onFlow);
    expect(onFlow + off).toBe(total);
    const listed = [
      ...view.stations.flatMap((station) =>
        [...station.families, ...station.shapes].flatMap((family) =>
          family.files.map((file) => file.path),
        ),
      ),
      ...view.off.flatMap((group) => group.files.map((file) => file.path)),
    ];
    expect([...listed].sort()).toEqual(analysis.files.map((file) => file.path).sort());
  });

  it("lists what the flow leaves out by kind, generated and mechanical files apart from code", () => {
    const off = viewOf().off.map((group) => [group.id, group.files.map((file) => file.path)]);
    expect(off).toEqual([
      ["code", ["package.json"]],
      ["generated", ["src/config/defaults.ts", "src/lib/dates.ts", "pnpm-lock.yaml"]],
    ]);
  });

  it("counts what a station hands on with the handoff, not with a station", () => {
    const view = viewOf({
      dataFlow: {
        ...fixtureDataFlow,
        stations: fixtureDataFlow.stations.map((station, index) =>
          index === 0
            ? { ...station, shapes: ["src/lib/money.ts"] }
            : { ...station, files: ["src/services/receipts.ts"] },
        ),
      },
    });
    expect(
      view.stations[0]?.shapes.flatMap((family) => family.files.map((file) => file.name)),
    ).toEqual(["money"]);
    expect(view.stations[1]?.families.flatMap((family) => family.files)).toHaveLength(1);
    expect(view.off.flatMap((group) => group.files.map((file) => file.path))).not.toContain(
      "src/lib/money.ts",
    );
  });

  it("says which neighbors nothing in the code joins", () => {
    expect(viewOf().stations.map((station) => station.joined)).toEqual([true, true]);
    const apart = viewOf({ fileLinks: [], callGraph: [], definitionCalls: [] });
    expect(apart.stations.map((station) => station.joined)).toEqual([false, true]);
  });

  it("names what existing code calls on the flow, and what's called in it", () => {
    const [route, receipts] = analysis.files
      .filter((file) => ["src/routes/orders.ts", "src/services/receipts.ts"].includes(file.path))
      .map((file) => file.hunks[0]?.id);
    if (route === undefined || receipts === undefined) throw new Error("the fixture has both");
    const view = viewOf({
      definitionCalls: [
        { name: "receiptRoute", partIds: [route], calls: [1, 1], requests: [] },
        { name: "cachedReceipt", partIds: [receipts], calls: [], requests: [] },
      ],
    });
    const files = view.stations.flatMap((station) =>
      station.families.flatMap((family) => family.files),
    );
    expect(files.map((file) => [file.name, file.calls, file.calledFor])).toEqual([
      ["orders", ["cachedReceipt"], []],
      ["receipts", [], ["cachedReceipt"]],
      ["money", [], []],
    ]);
  });
});

describe("familiesOf", () => {
  it("makes one of three files of a directory that end with the same words", () => {
    const families = familiesOf(
      [
        "pgo/BranchProfileRecorder.java",
        "pgo/ProfileDumper.java",
        "pgo/CallCountProfileRecorder.java",
        "pgo/TypeProfileRecorder.java",
      ].map(fileNamed),
    );
    expect(
      families.map((family) => [family.suffix, family.files.map((file) => file.name)]),
    ).toEqual([
      [
        "ProfileRecorder",
        ["BranchProfileRecorder", "CallCountProfileRecorder", "TypeProfileRecorder"],
      ],
      [null, ["ProfileDumper"]],
    ]);
    expect(families[0]).toMatchObject({ added: 30, deleted: 3 });
  });

  it("leaves two alike apart, and files of different directories", () => {
    const two = familiesOf(["a/request_models.py", "a/response_models.py"].map(fileNamed));
    expect(two.map((family) => family.suffix)).toEqual([null, null]);
    const apart = familiesOf(["a/x_key.py", "b/y_key.py", "c/z_key.py"].map(fileNamed));
    expect(apart.map((family) => family.suffix)).toEqual([null, null, null]);
  });

  it("takes the longest ending first, as the names write it", () => {
    const families = familiesOf(
      [
        "a/branch_profile_key.py",
        "a/call_profile_key.py",
        "a/type_profile_key.py",
        "a/api_key.py",
      ].map(fileNamed),
    );
    expect(families.map((family) => [family.suffix, family.files.length])).toEqual([
      ["profile_key", 3],
      [null, 1],
    ]);
  });

  it("never makes a family of files with one name", () => {
    const same = familiesOf(["a/key.ts", "a/key.py", "a/key.go"].map(fileNamed));
    expect(same.map((family) => family.suffix)).toEqual([null, null, null]);
  });
});

describe("noDataFlowOf", () => {
  const base = fixtureAnalysisView.analysis;
  const stages = (steps: Analysis["stages"]["steps"]) => ({ ...base.stages, steps });

  it("is null with a flow", () => {
    expect(noDataFlowOf(analysis)).toBeNull();
  });

  it("says why there's none", () => {
    expect(noDataFlowOf(base)).toEqual({ kind: "not-asked" });
    expect(noDataFlowOf({ ...base, stages: stages("running") })).toEqual({ kind: "writing" });
    expect(noDataFlowOf({ ...base, stages: stages("done") })).toEqual({ kind: "none" });
    expect(
      noDataFlowOf({
        ...base,
        stages: stages("failed"),
        stepsError: { stage: "steps", code: "model-error", message: "Overloaded" },
      }),
    ).toEqual({ kind: "failed", message: "Overloaded" });
    expect(
      noDataFlowOf({
        ...base,
        usage: [],
        modelError: null,
        stages: { ...base.stages, intent: "skipped", findings: "skipped", steps: "skipped" },
      }),
    ).toEqual({ kind: "no-review" });
  });

  it("has words for each reason", () => {
    expect(noDataFlowText({ kind: "failed", message: "Overloaded" })).toBe(
      "The data flow couldn't be written: Overloaded",
    );
    for (const kind of ["no-review", "not-asked", "writing"] as const) {
      expect(noDataFlowText({ kind })).toBeTruthy();
    }
  });

  it("says nothing when the review found no flow", () => {
    expect(noDataFlowText({ kind: "none" })).toBeNull();
  });
});
