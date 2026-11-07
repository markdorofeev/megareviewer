import { describe, expect, it } from "vitest";
import {
  type CallGraphHint,
  type FileChange,
  HunkId,
  type MechanicalProof,
} from "../../../../src/domain/diff/index.ts";
import {
  type RiskAssessment,
  type TourStep,
  TourStepId,
} from "../../../../src/domain/review/index.ts";
import { type FileOverview, fileOverview, type OverviewInput, uniqueLabels } from "./overview.ts";

const h = (n: number) => HunkId.parse(`h_${n.toString(16).padStart(16, "0")}`);

/** A file whose hunks are numbered `ids`, each adding `size` lines (the first line's text given). */
const file = (path: string, ids: readonly number[], text = "x = 1", size = 1): FileChange => ({
  path,
  oldPath: null,
  status: "modified",
  binary: false,
  oldMode: null,
  newMode: null,
  language: null,
  hunks: ids.map((n) => ({
    id: h(n),
    path,
    oldStart: n * 10,
    oldLines: 0,
    newStart: n * 10,
    newLines: size,
    sectionHeading: null,
    lines: Array.from({ length: size }, (_, at) => ({
      kind: "add" as const,
      oldLine: null,
      newLine: n * 10 + at,
      text: at === 0 ? text : "x = 1",
      noNewlineAtEnd: false,
    })),
  })),
  additions: size * ids.length,
  deletions: 0,
});

const call = (from: number, to: number, symbol = `f${to}`): CallGraphHint => ({
  fromHunkId: h(from),
  toHunkId: h(to),
  symbol,
  line: from * 10,
  use: "call",
});

const step = (
  n: number,
  title: string,
  hunks: readonly number[],
  entries: readonly number[] = [],
): TourStep => ({
  id: TourStepId.parse(`s${n}`),
  title,
  explanation: "",
  hunkIds: hunks.map(h),
  kind: entries.length > 0 || n < 90 ? "flow" : "supporting",
  via: [],
  entries: entries.map(h),
});

const input = (files: readonly FileChange[], more: Partial<OverviewInput> = {}): OverviewInput => ({
  files,
  proofs: [],
  risk: [],
  callGraph: [],
  fileLinks: [],
  generated: [],
  ...more,
});

/** A tour reading the files' hunks in the order given, as one step. */
const tourOf = (files: readonly FileChange[]): TourStep[] => [
  step(
    1,
    "Everything",
    files.flatMap((one) => one.hunks.map((hunk) => Number.parseInt(hunk.id.slice(2), 16))),
  ),
];

const rowsOf = (overview: FileOverview) =>
  overview.rows.map((row) => row.map((node) => node.label));

describe("fileOverview", () => {
  it("puts a chain in one row per file, from the file nothing calls", () => {
    const files = [file("c.py", [3]), file("a.py", [1]), file("b.py", [2])];
    const overview = fileOverview(
      input(files, { callGraph: [call(1, 2), call(2, 3)] }),
      tourOf(files),
    );
    expect(rowsOf(overview)).toEqual([["a.py"], ["b.py"], ["c.py"]]);
    expect(overview.edges.map((edge) => [edge.from, edge.to, edge.uses, edge.back])).toEqual([
      ["a.py", "b.py", ["call"], false],
      ["b.py", "c.py", ["call"], false],
    ]);
  });

  it("puts a file one row below its lowest caller, in a diamond", () => {
    // a calls b and d; b calls c; c calls d. d sits under c, not beside b.
    const files = [file("a.py", [1]), file("b.py", [2]), file("c.py", [3]), file("d.py", [4])];
    const overview = fileOverview(
      input(files, { callGraph: [call(1, 2), call(1, 4), call(2, 3), call(3, 4)] }),
      tourOf(files),
    );
    expect(rowsOf(overview)).toEqual([["a.py"], ["b.py"], ["c.py"], ["d.py"]]);
  });

  it("breaks a cycle at the edge into the file earliest in tour order", () => {
    const files = [file("a.py", [1]), file("b.py", [2]), file("c.py", [3])];
    const callGraph = [call(1, 2), call(2, 3), call(3, 1)];
    const overview = fileOverview(input(files, { callGraph }), tourOf(files));
    expect(rowsOf(overview)).toEqual([["a.py"], ["b.py"], ["c.py"]]);
    expect(overview.edges.filter((edge) => edge.back).map((edge) => [edge.from, edge.to])).toEqual([
      ["c.py", "a.py"],
    ]);
    // Read from c first, the cycle opens at c instead.
    const fromC = fileOverview(input(files, { callGraph }), [step(1, "From c", [3, 1, 2])]);
    expect(rowsOf(fromC)).toEqual([["c.py"], ["a.py"], ["b.py"]]);
  });

  it("orders a row by its callers' positions, so edges cross less", () => {
    // Read in this order, the second row would be y, x; x's caller is left of y's.
    const files = [file("a.py", [1]), file("b.py", [2]), file("y.py", [3]), file("x.py", [4])];
    const overview = fileOverview(
      input(files, { callGraph: [call(1, 4), call(2, 3)] }),
      tourOf(files),
    );
    expect(rowsOf(overview)).toEqual([
      ["a.py", "b.py"],
      ["x.py", "y.py"],
    ]);
  });

  it("merges imports, calls and type uses into one edge per pair", () => {
    const files = [file("a.py", [1]), file("b.py", [2])];
    const overview = fileOverview(
      input(files, {
        fileLinks: [{ from: "a.py", to: "b.py" }],
        callGraph: [call(1, 2, "run"), { ...call(1, 2, "Thing"), use: "type" }],
      }),
      tourOf(files),
    );
    expect(overview.edges).toEqual([
      {
        from: "a.py",
        to: "b.py",
        uses: ["import", "call", "type"],
        symbols: ["Thing", "run"],
        back: false,
      },
    ]);
  });

  it("makes tests and helpers badges on the code they reach, through a helper too", () => {
    const files = [
      file("app/service.py", [1]),
      file("app/store.py", [2]),
      file("tests/test_service.py", [3]),
      file("tests/fakes.py", [4]),
      file("src/testing/fake_clock.py", [5]),
      file("tests/test_lonely.py", [6]),
    ];
    const overview = fileOverview(
      input(files, {
        callGraph: [call(1, 2), call(3, 1), call(3, 4), call(4, 2), call(3, 5)],
      }),
      tourOf(files),
    );
    expect(rowsOf(overview)).toEqual([["service.py"], ["store.py"]]);
    const badges = (key: string) => overview.rows.flat().find((node) => node.key === key)?.badges;
    expect(badges("app/service.py")).toEqual(["tests/test_service.py"]);
    expect(badges("app/store.py")).toEqual(["tests/test_service.py", "tests/fakes.py"]);
    // A helper only tests use that reaches no code, and a test that links to nothing, are listed.
    expect(overview.strip.map((node) => node.label)).toEqual(["fake_clock.py", "test_lonely.py"]);
    expect(overview.placeOf.get("tests/fakes.py")).toBe("app/store.py");
  });

  it("keeps code only tests call as a node, unless its name says it's a helper", () => {
    const files = [file("app/prices.py", [1]), file("tests/test_prices.py", [2])];
    const overview = fileOverview(input(files, { callGraph: [call(2, 1)] }), tourOf(files));
    expect(overview.strip.map((node) => [node.label, node.badges])).toEqual([
      ["prices.py", ["tests/test_prices.py"]],
    ]);
  });

  it("shows a generated file as a faded node, not hidden", () => {
    const files = [file("web/Page.tsx", [1]), file("web/api/schema.d.ts", [2])];
    const overview = fileOverview(
      input(files, {
        callGraph: [{ ...call(1, 2), use: "type" }],
        generated: ["web/api/schema.d.ts"],
      }),
      tourOf(files),
    );
    expect(overview.rows.flat().map((node) => [node.label, node.generated])).toEqual([
      ["Page.tsx", false],
      ["schema.d.ts", true],
    ]);
  });

  it("lists unlinked files, docs and unlinked tests in the strip", () => {
    const files = [
      file("a.py", [1]),
      file("b.py", [2]),
      file("CONTRIBUTING.md", [3]),
      file("web/Guide.tsx", [4]),
      file("web/Guide.test.tsx", [5]),
    ];
    const overview = fileOverview(input(files, { callGraph: [call(1, 2)] }), tourOf(files));
    expect(overview.strip.map((node) => [node.key, node.row])).toEqual([
      ["CONTRIBUTING.md", -1],
      ["web/Guide.tsx", -1],
      ["web/Guide.test.tsx", -1],
    ]);
  });

  it("leaves out files whose every hunk is mechanical", () => {
    const files = [file("a.py", [1]), file("b.py", [2]), file("pnpm-lock.yaml", [3])];
    const proofs: MechanicalProof[] = [
      { hunkId: h(3), path: "pnpm-lock.yaml", kind: "generated", detail: "lockfile" },
    ];
    const overview = fileOverview(input(files, { proofs, callGraph: [call(1, 2)] }), tourOf(files));
    expect([...overview.placeOf.keys()].sort()).toEqual(["a.py", "b.py"]);
  });

  it("sums lines, takes the highest risk, and lists hunks in tour order", () => {
    const files = [file("a.py", [1, 2], "x = 1", 3), file("b.py", [3])];
    const risk: RiskAssessment[] = [
      { hunkId: h(1), riskClass: "logic", reason: "", source: "rule" },
      { hunkId: h(2), riskClass: "contract", reason: "", source: "rule" },
    ];
    const overview = fileOverview(input(files, { risk, callGraph: [call(1, 3)] }), [
      step(1, "Second hunk first", [2, 1, 3]),
    ]);
    const [a] = overview.rows[0] ?? [];
    expect([a?.added, a?.deleted, a?.risk, a?.hunkIds]).toEqual([6, 0, "contract", [h(2), h(1)]]);
    expect(a?.flows).toEqual(["Second hunk first"]);
  });

  it("labels entries: routes by count, a page and a command by the flow's title", () => {
    const more = file("api/more.py", [2], '@router.put("/b")');
    const files = [
      file("api/routes.py", [1], '@router.get("/a")'),
      {
        ...more,
        hunks: [...more.hunks, ...file("api/more.py", [3], '@router.delete("/b")').hunks],
      },
      file("web/routes/Setup.tsx", [4]),
      file("tools/cli.py", [5]),
      file("app/service.py", [6]),
    ];
    const steps = [
      step(1, "GET /a", [1, 6], [1]),
      step(2, "/b: PUT, DELETE", [2, 3], [2, 3]),
      step(3, "Page: Setup", [4], [4]),
      step(4, "Command: main in cli.py", [5], [5]),
    ];
    const callGraph = [call(1, 6), call(2, 6), call(4, 6), call(5, 6)];
    const overview = fileOverview(input(files, { callGraph }), steps);
    const entries = new Map(overview.rows.flat().map((node) => [node.label, node.entries]));
    expect(Object.fromEntries(entries)).toEqual({
      "routes.py": ["GET /a"],
      "more.py": ["2 routes"],
      "Setup.tsx": ["Page: Setup"],
      "cli.py": ["Command: main"],
      "service.py": [],
    });
  });

  it("gives two files with one name distinct labels", () => {
    expect([
      ...uniqueLabels([
        "app/routes/hosting_services.py",
        "app/domain/hosting_services.py",
        "app/keychain.py",
        "a/x/same.py",
        "b/x/same.py",
      ]).values(),
    ]).toEqual([
      "routes/hosting_services.py",
      "domain/hosting_services.py",
      "keychain.py",
      "a/x/same.py",
      "b/x/same.py",
    ]);
  });

  it("groups files by directory above 40 nodes, and expands a group in place", () => {
    const files = Array.from({ length: 45 }, (_, at) =>
      file(`src/module${at % 3}/part${at}.ts`, [at + 1]),
    );
    const callGraph = files.slice(0, -1).map((_, at) => call(at + 1, at + 2));
    const overview = fileOverview(input(files, { callGraph }), tourOf(files));
    expect(overview.grouped).toBe(true);
    // module0 → module1 → module2 → module0: the cycle opens at module0, read first.
    expect(rowsOf(overview)).toEqual([["src/module0/"], ["src/module1/"], ["src/module2/"]]);
    expect(overview.rows[0]?.[0]?.paths).toHaveLength(15);
    expect(overview.placeOf.get("src/module1/part4.ts")).toBe("group:src/module1");

    const opened = fileOverview(
      input(files, { callGraph }),
      tourOf(files),
      new Set(["group:src/module1"]),
    );
    const keys = opened.rows.flat().map((node) => node.key);
    expect(keys).toContain("src/module1/part4.ts");
    expect(keys).toContain("group:src/module0");
    expect(keys).not.toContain("group:src/module1");
  });

  it("places every file with a hunk to review exactly once, over random pull requests", () => {
    const paths = [
      "app/a.py",
      "app/b.py",
      "app/sub/c.py",
      "lib/d.py",
      "tests/test_a.py",
      "tests/fakes.py",
      "src/testing/helper.py",
      "README.md",
      "web/api/schema.d.ts",
    ];
    // A small seeded generator, so a failure reproduces.
    let seed = 11;
    const next = (max: number): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return (seed >>> 16) % max;
    };
    for (let run = 0; run < 300; run += 1) {
      const chosen = paths.filter(() => next(3) !== 0);
      const files = chosen.map((path, at) => file(path, [at + 1]));
      const count = files.length;
      const callGraph = Array.from({ length: count === 0 ? 0 : next(12) }, () => ({
        ...call(next(count) + 1, next(count) + 1),
        use: next(3) === 0 ? ("type" as const) : ("call" as const),
      })).filter((hint) => hint.fromHunkId !== hint.toHunkId);
      const proofs = chosen.flatMap((path, at): MechanicalProof[] =>
        next(5) === 0 ? [{ hunkId: h(at + 1), path, kind: "whitespace", detail: "spaces" }] : [],
      );
      const overview = fileOverview(input(files, { callGraph, proofs }), tourOf(files));
      const proved = new Set(proofs.map((proof) => proof.path));
      const toReview = chosen.filter((path) => !proved.has(path)).sort();
      const asNode = [...overview.rows.flat(), ...overview.strip].flatMap((node) => node.paths);
      const asBadge = new Set(
        overview.rows
          .flat()
          .concat(overview.strip)
          .flatMap((node) => node.badges)
          .filter((path) => !asNode.includes(path)),
      );
      expect([...asNode, ...asBadge].sort()).toEqual(toReview);
      expect(new Set(asNode).size).toBe(asNode.length);
      expect([...overview.placeOf.keys()].sort()).toEqual(toReview);
    }
  });
});
