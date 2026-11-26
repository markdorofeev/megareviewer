import { describe, expect, it } from "vitest";
import { smallFeatureAnalysis } from "../../application/testing/fixtures/small-feature-analysis.ts";
import {
  type DataFlow,
  type DataFlowContext,
  dataFlowContext,
  keptDataFlow,
  type Station,
  validateDataFlow,
} from "./data-flow.ts";

const station = (name: string, files: string[], more: Partial<Station> = {}): Station => ({
  name,
  when: null,
  keeps: false,
  files,
  gives: null,
  shapes: [],
  ...more,
});

const flowOf = (...stations: Station[]): DataFlow => ({ source: null, stations, end: null });

/** Files a.ts to h.ts and key.ts, each joined to the next letter, and b.ts to key.ts. */
const context: DataFlowContext = (() => {
  const letters = ["a", "b", "c", "d", "e", "f", "g", "h"].map((letter) => `${letter}.ts`);
  const pairs = new Set(letters.slice(1).map((path, at) => `${letters[at]} ${path}`));
  pairs.add("b.ts key.ts");
  return {
    paths: new Set([...letters, "key.ts", "lonely.ts"]),
    linked: (a, b) => pairs.has(`${a} ${b}`) || pairs.has(`${b} ${a}`),
  };
})();

describe("validateDataFlow", () => {
  it("finds nothing wrong with stations of the pull request's files, each joined to the next", () => {
    const flow = flowOf(station("Take", ["a.ts"]), station("Keep", ["b.ts"]));
    expect(validateDataFlow(flow, context)).toEqual([]);
    expect(keptDataFlow(flow, context)).toEqual(flow);
  });

  it("names a file that isn't the pull request's, and one placed twice", () => {
    const flow = flowOf(
      station("Take", ["a.ts", "src/made-up.ts"]),
      station("Keep", ["b.ts", "a.ts"], { shapes: ["b.ts"] }),
    );
    expect(validateDataFlow(flow, context)).toEqual([
      { kind: "unknown-file", station: 0, path: "src/made-up.ts" },
      { kind: "repeated-file", station: 1, path: "a.ts" },
      { kind: "repeated-file", station: 1, path: "b.ts" },
    ]);
    expect(keptDataFlow(flow, context)?.stations).toMatchObject([
      { files: ["a.ts"], shapes: [] },
      { files: ["b.ts"], shapes: [] },
    ]);
  });

  it("keeps a file listed twice in one station once", () => {
    const flow = flowOf(station("Take", ["a.ts", "a.ts"]), station("Keep", ["b.ts"]));
    expect(keptDataFlow(flow, context)?.stations[0]?.files).toEqual(["a.ts"]);
  });

  it("drops a station left without a file or a name, and joins what's around it", () => {
    const flow = flowOf(
      station("Take", ["a.ts"]),
      station("Made up", ["nowhere.ts"]),
      station("  ", ["h.ts"]),
      station("Keep", ["b.ts"]),
    );
    expect(validateDataFlow(flow, context)).toEqual([
      { kind: "unknown-file", station: 1, path: "nowhere.ts" },
      { kind: "no-files", station: 1 },
      { kind: "unnamed", station: 2 },
    ]);
    expect(keptDataFlow(flow, context)?.stations.map((one) => one.name)).toEqual(["Take", "Keep"]);
  });

  it("doesn't take a station's shapes for its files", () => {
    const flow = flowOf(station("Take", ["a.ts"]), station("Keep", [], { shapes: ["b.ts"] }));
    expect(validateDataFlow(flow, context)).toContainEqual({ kind: "no-files", station: 1 });
    expect(keptDataFlow(flow, context)).toBeNull();
  });

  it("says which neighbors nothing joins, and keeps them", () => {
    const flow = flowOf(
      station("Take", ["a.ts"]),
      station("Keep", ["b.ts"]),
      station("Apart", ["lonely.ts"]),
    );
    expect(validateDataFlow(flow, context)).toEqual([{ kind: "unlinked", station: 1, next: 2 }]);
    expect(keptDataFlow(flow, context)?.stations).toHaveLength(3);
  });

  it("joins two stations through what the first hands on", () => {
    const apart = flowOf(station("Take", ["a.ts"]), station("Use", ["key.ts"]));
    expect(validateDataFlow(apart, context)).toEqual([{ kind: "unlinked", station: 0, next: 1 }]);
    const joined = flowOf(
      station("Take", ["a.ts"], { shapes: ["key.ts"] }),
      station("Use", ["b.ts"]),
    );
    expect(validateDataFlow(joined, context)).toEqual([]);
  });

  it("checks a station's join against the next one kept, not one that's dropped", () => {
    const flow = flowOf(
      station("Take", ["a.ts"]),
      station("Made up", ["nowhere.ts"]),
      station("Apart", ["lonely.ts"]),
    );
    expect(validateDataFlow(flow, context)).toContainEqual({
      kind: "unlinked",
      station: 0,
      next: 2,
    });
  });

  it("keeps the first seven stations", () => {
    const letters = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const flow = flowOf(...letters.map((letter) => station(letter, [`${letter}.ts`])));
    expect(validateDataFlow(flow, context)).toEqual([{ kind: "too-many", station: 7 }]);
    expect(keptDataFlow(flow, context)?.stations).toHaveLength(7);
  });

  it("is no flow with fewer than two stations left", () => {
    expect(keptDataFlow(flowOf(station("Take", ["a.ts"])), context)).toBeNull();
    expect(
      keptDataFlow(flowOf(station("Take", ["a.ts"]), station("Gone", ["x.ts"])), context),
    ).toBeNull();
  });

  it("trims its texts, and takes an empty one for none", () => {
    const flow: DataFlow = {
      source: "  a request ",
      stations: [
        station(" Take ", ["a.ts"], { when: " ", gives: " an order " }),
        station("Keep", ["b.ts"], { gives: "" }),
      ],
      end: "",
    };
    expect(keptDataFlow(flow, context)).toMatchObject({
      source: "a request",
      stations: [
        { name: "Take", when: null, gives: "an order" },
        { name: "Keep", gives: null },
      ],
      end: null,
    });
  });
});

describe("dataFlowContext", () => {
  const { paths, linked } = dataFlowContext(smallFeatureAnalysis);

  it("knows the pull request's files", () => {
    expect(paths.has("src/services/receipts.ts")).toBe(true);
    expect(paths.has("src/services/orders.ts")).toBe(false);
  });

  it("joins two files one of which calls the other, either way", () => {
    expect(linked("src/routes/orders.ts", "src/services/receipts.ts")).toBe(true);
    expect(linked("src/services/receipts.ts", "src/routes/orders.ts")).toBe(true);
  });

  it("joins no file to itself, nor two that nothing links", () => {
    expect(linked("src/routes/orders.ts", "src/routes/orders.ts")).toBe(false);
    expect(linked("config/app.yaml", "src/services/receipts.ts")).toBe(false);
  });
});
