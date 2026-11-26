import { describe, expect, it } from "vitest";
import {
  type CallGraphHint,
  type FileChange,
  HunkId,
  type MechanicalProof,
  PartId,
  type UnchangedCallers,
} from "../../../../src/domain/diff/index.ts";
import type { Flow, RiskAssessment } from "../../../../src/domain/review/index.ts";
import { directoryOf } from "../../review/tree/paths.ts";
import {
  type FileOverview,
  fileOverview,
  groupKey,
  type OverviewInput,
  uniqueLabels,
} from "./overview.ts";

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
  fromPartId: h(from),
  toPartId: h(to),
  symbol,
  line: from * 10,
  use: "call",
});

/** Flow `n`: its title, its hunks and the entries it starts at. */
const flow = (
  n: number,
  title: string,
  hunks: readonly number[],
  entries: readonly number[] = [],
): Flow => ({
  title,
  partIds: hunks.map(h),
  kind: entries.length > 0 || n < 90 ? "flow" : "supporting",
  entries: entries.map(h),
});

const input = (files: readonly FileChange[], more: Partial<OverviewInput> = {}): OverviewInput => ({
  files,
  proofs: [],
  risk: [],
  parts: [],
  callGraph: [],
  fileLinks: [],
  generated: [],
  flows: null,
  ...more,
});

/** The overview of `analysis` read by `flows`. */
const overviewOf = (
  analysis: OverviewInput,
  flows: readonly Flow[],
  expanded?: ReadonlySet<string>,
): FileOverview => fileOverview({ ...analysis, flows }, expanded);

/** One flow reading the files' hunks in the order given. */
const flowOf = (files: readonly FileChange[]): Flow[] => [
  flow(
    1,
    "Everything",
    files.flatMap((one) => one.hunks.map((hunk) => Number.parseInt(hunk.id.slice(2), 16))),
  ),
];

/** The overview with every directory opened in place, so each file is a node of its own. */
const opened = (analysis: OverviewInput, flows: readonly Flow[]): FileOverview =>
  overviewOf(
    analysis,
    flows,
    new Set(analysis.files.map((one) => groupKey(directoryOf(one.path)))),
  );

const rowsOf = (overview: FileOverview) =>
  overview.rows.map((row) => row.map((node) => node.label));

describe("fileOverview with every directory opened", () => {
  it("puts a chain in one row per file, from the file nothing calls", () => {
    const files = [file("c.py", [3]), file("a.py", [1]), file("b.py", [2])];
    const overview = opened(input(files, { callGraph: [call(1, 2), call(2, 3)] }), flowOf(files));
    expect(rowsOf(overview)).toEqual([["a.py"], ["b.py"], ["c.py"]]);
    expect(overview.edges.map((edge) => [edge.from, edge.to, edge.uses, edge.back])).toEqual([
      ["a.py", "b.py", ["call"], false],
      ["b.py", "c.py", ["call"], false],
    ]);
  });

  it("puts a file one row below its lowest caller, in a diamond", () => {
    // a calls b and d; b calls c; c calls d. d sits under c, not beside b.
    const files = [file("a.py", [1]), file("b.py", [2]), file("c.py", [3]), file("d.py", [4])];
    const overview = opened(
      input(files, { callGraph: [call(1, 2), call(1, 4), call(2, 3), call(3, 4)] }),
      flowOf(files),
    );
    expect(rowsOf(overview)).toEqual([["a.py"], ["b.py"], ["c.py"], ["d.py"]]);
  });

  it("breaks a cycle at the edge into the file earliest in reading order", () => {
    const files = [file("a.py", [1]), file("b.py", [2]), file("c.py", [3])];
    const callGraph = [call(1, 2), call(2, 3), call(3, 1)];
    const overview = opened(input(files, { callGraph }), flowOf(files));
    expect(rowsOf(overview)).toEqual([["a.py"], ["b.py"], ["c.py"]]);
    expect(overview.edges.filter((edge) => edge.back).map((edge) => [edge.from, edge.to])).toEqual([
      ["c.py", "a.py"],
    ]);
    // Read from c first, the cycle opens at c instead.
    const fromC = opened(input(files, { callGraph }), [flow(1, "From c", [3, 1, 2])]);
    expect(rowsOf(fromC)).toEqual([["c.py"], ["a.py"], ["b.py"]]);
  });

  it("orders a row by its callers' positions, so edges cross less", () => {
    // Read in this order, the second row would be y, x; x's caller is left of y's.
    const files = [file("a.py", [1]), file("b.py", [2]), file("y.py", [3]), file("x.py", [4])];
    const overview = opened(input(files, { callGraph: [call(1, 4), call(2, 3)] }), flowOf(files));
    expect(rowsOf(overview)).toEqual([
      ["a.py", "b.py"],
      ["x.py", "y.py"],
    ]);
  });

  it("merges imports, calls and type uses into one edge per pair", () => {
    const files = [file("a.py", [1]), file("b.py", [2])];
    const overview = opened(
      input(files, {
        fileLinks: [{ from: "a.py", to: "b.py" }],
        callGraph: [call(1, 2, "run"), { ...call(1, 2, "Thing"), use: "type" }],
      }),
      flowOf(files),
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

  it("draws a request from the file that sends it to the routes it reaches, under it", () => {
    const files = [
      file("web/src/routes/setup.tsx", [1]),
      file("web/src/Connections.tsx", [2]),
      file("api/routes.py", [3]),
      file("tests/test_api.py", [4]),
    ];
    const request = (from: number, to: number, symbol: string): CallGraphHint => ({
      ...call(from, to, symbol),
      use: "request",
    });
    const overview = opened(
      input(files, {
        callGraph: [
          call(1, 2),
          request(2, 3, "GET /api/items"),
          request(2, 3, "PUT /api/items/{id}"),
          request(4, 3, "GET /api/items"),
        ],
      }),
      flowOf(files),
    );
    expect(rowsOf(overview)).toEqual([["setup.tsx"], ["Connections.tsx"], ["routes.py"]]);
    expect(overview.edges[1]).toEqual({
      from: "web/src/Connections.tsx",
      to: "api/routes.py",
      uses: ["request"],
      symbols: ["GET /api/items", "PUT /api/items/{id}"],
      back: false,
    });
    expect(overview.rows[2]?.[0]?.badges).toEqual(["tests/test_api.py"]);
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
    const overview = opened(
      input(files, {
        callGraph: [call(1, 2), call(3, 1), call(3, 4), call(4, 2), call(3, 5)],
      }),
      flowOf(files),
    );
    expect(rowsOf(overview)).toEqual([["service.py"], ["store.py"]]);
    const badges = (key: string) => overview.rows.flat().find((node) => node.key === key)?.badges;
    expect(badges("app/service.py")).toEqual(["tests/test_service.py"]);
    expect(badges("app/store.py")).toEqual(["tests/test_service.py", "tests/fakes.py"]);
    // A helper only tests use that reaches no code, and a test that links to nothing, are listed,
    // never a box.
    expect(overview.strip).toEqual([]);
    expect(overview.tests).toEqual(["src/testing/fake_clock.py", "tests/test_lonely.py"]);
    expect(overview.placeOf.get("tests/fakes.py")).toBe("app/store.py");
    expect(overview.placeOf.has("tests/test_lonely.py")).toBe(false);
  });

  it("keeps code only tests call as a node, unless its name says it's a helper", () => {
    const files = [file("app/prices.py", [1]), file("tests/test_prices.py", [2])];
    const overview = opened(input(files, { callGraph: [call(2, 1)] }), flowOf(files));
    expect(overview.strip.map((node) => [node.label, node.badges])).toEqual([
      ["prices.py", ["tests/test_prices.py"]],
    ]);
  });

  it("shows a generated file as a faded node, not hidden", () => {
    const files = [file("web/Page.tsx", [1]), file("web/api/schema.d.ts", [2])];
    const overview = opened(
      input(files, {
        callGraph: [{ ...call(1, 2), use: "type" }],
        generated: ["web/api/schema.d.ts"],
      }),
      flowOf(files),
    );
    expect(overview.rows.flat().map((node) => [node.label, node.generated])).toEqual([
      ["Page.tsx", false],
      ["schema.d.ts", true],
    ]);
  });

  it("lists unlinked files and docs in the strip, and unlinked tests apart", () => {
    const files = [
      file("a.py", [1]),
      file("b.py", [2]),
      file("CONTRIBUTING.md", [3]),
      file("web/Guide.tsx", [4]),
      file("web/Guide.test.tsx", [5]),
    ];
    const overview = opened(input(files, { callGraph: [call(1, 2)] }), flowOf(files));
    expect(overview.strip.map((node) => [node.key, node.row])).toEqual([
      ["CONTRIBUTING.md", -1],
      ["web/Guide.tsx", -1],
    ]);
    expect(overview.tests).toEqual(["web/Guide.test.tsx"]);
  });

  it("makes no box of a test directory whose tests reach no code", () => {
    const files = [
      file("svm/src/core/pgo/Recorder.java", [1]),
      file("svm/src/core/pgo/Dumper.java", [2]),
      file("svm/src/core.test/src/core/pgo/RecorderTest.java", [3]),
      file("svm/src/core.test/src/core/pgo/DumperTest.java", [4]),
    ];
    const overview = opened(input(files, { callGraph: [call(1, 2), call(3, 4)] }), flowOf(files));
    const boxed = [...overview.rows.flat(), ...overview.strip].flatMap((node) => node.paths);
    expect(boxed).toEqual(["svm/src/core/pgo/Recorder.java", "svm/src/core/pgo/Dumper.java"]);
    expect(overview.edges.map((edge) => [edge.from, edge.to])).toEqual([
      ["svm/src/core/pgo/Recorder.java", "svm/src/core/pgo/Dumper.java"],
    ]);
    expect(overview.tests).toEqual([
      "svm/src/core.test/src/core/pgo/DumperTest.java",
      "svm/src/core.test/src/core/pgo/RecorderTest.java",
    ]);
  });

  it("leaves out files whose every hunk is mechanical", () => {
    const files = [file("a.py", [1]), file("b.py", [2]), file("pnpm-lock.yaml", [3])];
    const proofs: MechanicalProof[] = [
      { hunkId: h(3), path: "pnpm-lock.yaml", kind: "generated", detail: "lockfile" },
    ];
    const overview = opened(input(files, { proofs, callGraph: [call(1, 2)] }), flowOf(files));
    expect([...overview.placeOf.keys()].sort()).toEqual(["a.py", "b.py"]);
  });

  it("sums lines, shows contract as logic, and lists hunks in reading order", () => {
    const files = [file("a.py", [1, 2], "x = 1", 3), file("b.py", [3])];
    const risk: RiskAssessment[] = [
      { hunkId: h(1), riskClass: "logic", reason: "", source: "rule" },
      {
        hunkId: h(2),
        riskClass: "contract",
        reason: "",
        source: "rule",
      },
    ];
    const overview = opened(input(files, { risk, callGraph: [call(1, 3)] }), [
      flow(1, "Second hunk first", [2, 1, 3]),
    ]);
    const [a] = overview.rows[0] ?? [];
    expect([a?.added, a?.deleted, a?.risk, a?.partIds]).toEqual([6, 0, "logic", [h(2), h(1)]]);
    expect(a?.flows).toEqual(["Second hunk first"]);
  });

  it("counts a file's routes once when each starts a flow of its own, as parts of one hunk", () => {
    const two = file("api/routes.py", [1], '@router.get("/a")', 2);
    const [whole] = two.hunks;
    if (whole === undefined) throw new Error("no hunk");
    const hunk = {
      ...whole,
      lines: whole.lines.map((line, at) =>
        at === 1 ? { ...line, text: '@router.put("/b")' } : line,
      ),
    };
    const routes = { ...two, hunks: [hunk] };
    const part = (n: number) => PartId.parse(`${hunk.id}.${n}`);
    const parts = [1, 2].map((n) => ({
      id: part(n),
      hunkId: hunk.id,
      start: n - 1,
      end: n,
      definitions: [],
    }));
    const flows = [1, 2].map(
      (n): Flow => ({ title: `Route ${n}`, partIds: [part(n)], kind: "flow", entries: [part(n)] }),
    );
    const overview = opened(input([routes], { parts }), flows);
    const [node] = [...overview.rows.flat(), ...overview.strip];
    expect(node?.entries).toEqual(["2 routes"]);
    expect(node?.partIds).toEqual([part(1), part(2)]);
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
    const flows = [
      flow(1, "GET /a", [1, 6], [1]),
      flow(2, "/b: PUT, DELETE", [2, 3], [2, 3]),
      flow(3, "Page: Setup", [4], [4]),
      flow(4, "Command: main in cli.py", [5], [5]),
    ];
    const callGraph = [call(1, 6), call(2, 6), call(4, 6), call(5, 6)];
    const overview = opened(input(files, { callGraph }), flows);
    const entries = new Map(overview.rows.flat().map((node) => [node.label, node.entries]));
    expect(Object.fromEntries(entries)).toEqual({
      "routes.py": ["GET /a"],
      "more.py": ["2 routes"],
      "Setup.tsx": ["Page: Setup"],
      "cli.py": ["Command: main"],
      "service.py": [],
    });
  });

  it("gives a file no flow lists its box all the same, after the flows' files", () => {
    const files = [file("app/a.py", [1]), file("lib/z.py", [2]), file("lib/b.py", [3])];
    const overview = overviewOf(input(files), [flow(1, "GET /a", [1], [1])]);
    const nodes = [...overview.rows.flat(), ...overview.strip];
    expect(nodes.map((node) => node.label)).toEqual(["app/", "lib/"]);
    expect(nodes[1]?.partIds).toEqual([h(3), h(2)]);
    expect(overview.placeOf.get("lib/z.py")).toBe("group:lib");
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
      })).filter((hint) => hint.fromPartId !== hint.toPartId);
      const proofs = chosen.flatMap((path, at): MechanicalProof[] =>
        next(5) === 0 ? [{ hunkId: h(at + 1), path, kind: "whitespace", detail: "spaces" }] : [],
      );
      const overview = overviewOf(input(files, { callGraph, proofs }), flowOf(files));
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
      expect([...asNode, ...asBadge, ...overview.tests].sort()).toEqual(toReview);
      expect(new Set(asNode).size).toBe(asNode.length);
      expect([...overview.placeOf.keys(), ...overview.tests].sort()).toEqual(toReview);
    }
  });
});

/** Uses of what hunk `n` changes, one per path, outside the pull request. */
const usedBy = (
  n: number,
  symbol: string,
  paths: readonly string[],
  more = 0,
): UnchangedCallers => ({
  partId: h(n),
  symbol,
  uses: paths.map((path) => ({
    path,
    line: 3,
    use: "call" as const,
    excerpt: { start: 1, lines: ["a", "b", symbol] },
  })),
  more,
});

describe("fileOverview outside the pull request", () => {
  const files = [
    file("app/main.py", [1]),
    file("app/store.py", [2]),
    file("lib/text.py", [3]),
    file("tests/test_store.py", [4]),
  ];
  const linked = {
    callGraph: [call(1, 2)],
    fileLinks: [{ from: "app/main.py", to: "lib/text.py" }],
  };
  const usesOf = (
    unchangedCallers: readonly UnchangedCallers[],
    expanded: readonly string[] = [],
  ) => {
    const overview = fileOverview(
      { ...input(files, { ...linked, unchangedCallers }), flows: flowOf(files) },
      new Set(expanded),
    );
    return [...overview.rows.flat(), ...overview.strip].map((node) => [node.key, node.uses]);
  };

  it("counts on a directory the places that use what its files change, tests aside", () => {
    const callers = [
      usedBy(1, "main", ["jobs/sync.py"]),
      usedBy(2, "save", ["jobs/sync.py", "jobs/nightly.py", "tests/test_sync.py"], 4),
      usedBy(4, "make_store", ["jobs/fixtures.py"]),
    ];
    expect(usesOf(callers)).toEqual([
      ["group:app", 3],
      ["group:lib", 0],
    ]);
    expect(usesOf(callers, ["group:app"])).toContainEqual(["app/store.py", 2]);
  });

  it("counts the uses past the limit when they can be code", () => {
    expect(usesOf([usedBy(3, "slug", ["jobs/a.py", "jobs/b.py"], 7)])).toContainEqual([
      "group:lib",
      9,
    ]);
  });

  it("draws the same diagram with them or without: no node, no edge, no row", () => {
    const keys = (unchangedCallers: readonly UnchangedCallers[]) => {
      const { rows, edges, strip } = fileOverview({
        ...input(files, { ...linked, unchangedCallers }),
        flows: flowOf(files),
      });
      return [rows.map((row) => row.map((node) => node.key)), edges, strip.map((node) => node.key)];
    };
    expect(keys([usedBy(2, "save", ["jobs/sync.py"]), usedBy(4, "make", ["jobs/a.py"])])).toEqual(
      keys([]),
    );
  });
});

describe("fileOverview by directory", () => {
  const contract = (n: number): RiskAssessment => ({
    hunkId: h(n),
    riskClass: "contract",
    reason: "",
    source: "rule",
  });

  it("makes each directory a box with its files, its risk and its tests, never contract", () => {
    const files = [
      file("api/routes.py", [1]),
      file("api/models.py", [2]),
      file("svc/run.py", [3]),
      file("docs/guide.md", [4]),
      file("tests/test_api.py", [5]),
    ];
    const analysis = input(files, {
      risk: [contract(1)],
      callGraph: [call(1, 3), call(1, 2), call(5, 1)],
    });
    const overview = overviewOf(analysis, flowOf(files));
    expect(rowsOf(overview)).toEqual([["api/"], ["svc/"]]);
    expect(overview.rows[0]?.[0]).toMatchObject({
      key: "group:api",
      kind: "group",
      paths: ["api/models.py", "api/routes.py"],
      risk: "logic",
      badges: ["tests/test_api.py"],
    });
    expect(overview.strip.map((node) => node.label)).toEqual(["docs/"]);
    expect(overview.placeOf.get("api/routes.py")).toBe("group:api");
    expect(overview.placeOf.get("tests/test_api.py")).toBe("group:api");
  });

  it("labels a Java module's package without the module's name again", () => {
    const core = "substratevm/src/com.oracle.svm.core/src/com/oracle/svm/core";
    const files = [
      file(`${core}/Isolates.java`, [1]),
      file(`${core}/SubstrateOptions.java`, [2]),
      file(`${core}/pgo/Profile.java`, [3]),
      file(`${core}/pgo/Recorder.java`, [4]),
    ];
    const overview = overviewOf(input(files), flowOf(files));
    expect(overview.strip.map((node) => [node.key, node.label])).toEqual([
      [`group:${core}`, "substratevm/src/com.oracle.svm.core/"],
      [`group:${core}/pgo`, "substratevm/src/com.oracle.svm.core/pgo/"],
    ]);
  });

  it("merges the links between two directories into one edge, keeping its request", () => {
    const files = [
      file("web/Page.tsx", [1]),
      file("web/client.ts", [2]),
      file("api/routes.py", [3]),
      file("api/models.py", [4]),
    ];
    const overview = overviewOf(
      input(files, {
        callGraph: [
          call(1, 2),
          { ...call(2, 3, "GET /items"), use: "request" },
          { ...call(1, 4, "Item"), use: "type" },
        ],
      }),
      flowOf(files),
    );
    expect(overview.edges).toEqual([
      {
        from: "group:web",
        to: "group:api",
        uses: ["type", "request"],
        symbols: ["GET /items", "Item"],
        back: false,
      },
    ]);
  });

  it("draws upward the edge joining fewer files when two directories call each other", () => {
    const files = [
      file("http/app.py", [1]),
      file("http/models.py", [2]),
      file("http/routes/items.py", [3]),
    ];
    const registers = { from: "http/app.py", to: "http/routes/items.py" };
    // routes calls two files of http; http imports one of routes.
    const heavier = overviewOf(
      input(files, { fileLinks: [registers], callGraph: [call(3, 2), call(3, 1)] }),
      flowOf(files),
    );
    expect(rowsOf(heavier)).toEqual([["http/routes/"], ["http/"]]);
    expect(heavier.edges.filter((edge) => edge.back).map((edge) => edge.from)).toEqual([
      "group:http",
    ]);
    // On a tie, the edge into the directory read first points up, as for files.
    const tied = overviewOf(
      input(files, { fileLinks: [registers], callGraph: [call(3, 2)] }),
      flowOf(files),
    );
    expect(rowsOf(tied)).toEqual([["http/"], ["http/routes/"]]);
  });

  it("opens a directory in place to its files", () => {
    const files = [file("api/routes.py", [1]), file("api/models.py", [2]), file("svc/run.py", [3])];
    const overview = overviewOf(
      input(files, { callGraph: [call(1, 3), call(2, 3)] }),
      flowOf(files),
      new Set([groupKey("api")]),
    );
    expect(overview.rows.flat().map((node) => node.key)).toEqual([
      "api/routes.py",
      "api/models.py",
      "group:svc",
    ]);
    expect(overview.placeOf.get("api/models.py")).toBe("api/models.py");
  });
});
