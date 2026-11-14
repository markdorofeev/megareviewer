import { describe, expect, it } from "vitest";
import {
  type CallGraphHint,
  type FileChange,
  HunkId,
  type MechanicalProof,
  PartId,
  type UnchangedCallers,
} from "../../../../src/domain/diff/index.ts";
import {
  type RiskAssessment,
  type TourStep,
  TourStepId,
} from "../../../../src/domain/review/index.ts";
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

const step = (
  n: number,
  title: string,
  hunks: readonly number[],
  entries: readonly number[] = [],
): TourStep => ({
  id: TourStepId.parse(`s${n}`),
  title,
  explanation: "",
  partIds: hunks.map(h),
  kind: entries.length > 0 || n < 90 ? "flow" : "supporting",
  via: [],
  entries: entries.map(h),
  codeTitle: null,
  merged: [],
});

const input = (files: readonly FileChange[], more: Partial<OverviewInput> = {}): OverviewInput => ({
  files,
  proofs: [],
  risk: [],
  parts: [],
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

/** The overview with every directory opened in place, so each file is a node of its own. */
const opened = (analysis: OverviewInput, steps: readonly TourStep[]): FileOverview =>
  fileOverview(
    analysis,
    steps,
    new Set(analysis.files.map((one) => groupKey(directoryOf(one.path)))),
  );

const rowsOf = (overview: FileOverview) =>
  overview.rows.map((row) => row.map((node) => node.label));

describe("fileOverview with every directory opened", () => {
  it("puts a chain in one row per file, from the file nothing calls", () => {
    const files = [file("c.py", [3]), file("a.py", [1]), file("b.py", [2])];
    const overview = opened(input(files, { callGraph: [call(1, 2), call(2, 3)] }), tourOf(files));
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
      tourOf(files),
    );
    expect(rowsOf(overview)).toEqual([["a.py"], ["b.py"], ["c.py"], ["d.py"]]);
  });

  it("breaks a cycle at the edge into the file earliest in tour order", () => {
    const files = [file("a.py", [1]), file("b.py", [2]), file("c.py", [3])];
    const callGraph = [call(1, 2), call(2, 3), call(3, 1)];
    const overview = opened(input(files, { callGraph }), tourOf(files));
    expect(rowsOf(overview)).toEqual([["a.py"], ["b.py"], ["c.py"]]);
    expect(overview.edges.filter((edge) => edge.back).map((edge) => [edge.from, edge.to])).toEqual([
      ["c.py", "a.py"],
    ]);
    // Read from c first, the cycle opens at c instead.
    const fromC = opened(input(files, { callGraph }), [step(1, "From c", [3, 1, 2])]);
    expect(rowsOf(fromC)).toEqual([["c.py"], ["a.py"], ["b.py"]]);
  });

  it("orders a row by its callers' positions, so edges cross less", () => {
    // Read in this order, the second row would be y, x; x's caller is left of y's.
    const files = [file("a.py", [1]), file("b.py", [2]), file("y.py", [3]), file("x.py", [4])];
    const overview = opened(input(files, { callGraph: [call(1, 4), call(2, 3)] }), tourOf(files));
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
      tourOf(files),
    );
    expect(overview.edges).toEqual([
      {
        from: "a.py",
        to: "b.py",
        uses: ["import", "call", "type"],
        symbols: ["Thing", "run"],
        back: false,
        outside: false,
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
      tourOf(files),
    );
    expect(rowsOf(overview)).toEqual([["setup.tsx"], ["Connections.tsx"], ["routes.py"]]);
    expect(overview.edges[1]).toEqual({
      from: "web/src/Connections.tsx",
      to: "api/routes.py",
      uses: ["request"],
      symbols: ["GET /api/items", "PUT /api/items/{id}"],
      back: false,
      outside: false,
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
    const overview = opened(input(files, { callGraph: [call(2, 1)] }), tourOf(files));
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
    const overview = opened(input(files, { callGraph: [call(1, 2)] }), tourOf(files));
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
    const overview = opened(input(files, { proofs, callGraph: [call(1, 2)] }), tourOf(files));
    expect([...overview.placeOf.keys()].sort()).toEqual(["a.py", "b.py"]);
  });

  it("sums lines, shows contract as logic, and lists hunks in tour order", () => {
    const files = [file("a.py", [1, 2], "x = 1", 3), file("b.py", [3])];
    const risk: RiskAssessment[] = [
      { hunkId: h(1), riskClass: "logic", reason: "", source: "rule", lines: null },
      { hunkId: h(2), riskClass: "contract", reason: "", source: "rule", lines: null },
    ];
    const overview = opened(input(files, { risk, callGraph: [call(1, 3)] }), [
      step(1, "Second hunk first", [2, 1, 3]),
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
    const steps = [1, 2].map(
      (n): TourStep => ({
        id: TourStepId.parse(`s${n}`),
        title: `Route ${n}`,
        explanation: "",
        partIds: [part(n)],
        kind: "flow",
        via: [],
        entries: [part(n)],
        codeTitle: null,
        merged: [],
      }),
    );
    const overview = opened(input([routes], { parts }), steps);
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
    const steps = [
      step(1, "GET /a", [1, 6], [1]),
      step(2, "/b: PUT, DELETE", [2, 3], [2, 3]),
      step(3, "Page: Setup", [4], [4]),
      step(4, "Command: main in cli.py", [5], [5]),
    ];
    const callGraph = [call(1, 6), call(2, 6), call(4, 6), call(5, 6)];
    const overview = opened(input(files, { callGraph }), steps);
    const entries = new Map(overview.rows.flat().map((node) => [node.label, node.entries]));
    expect(Object.fromEntries(entries)).toEqual({
      "routes.py": ["GET /a"],
      "more.py": ["2 routes"],
      "Setup.tsx": ["Page: Setup"],
      "cli.py": ["Command: main"],
      "service.py": [],
    });
  });

  it("reads a page's and a command's entries from the code's title when the model titled them", () => {
    const files = [
      file("web/routes/Setup.tsx", [4]),
      file("tools/cli.py", [5]),
      file("app/s.py", [6]),
    ];
    const titled = (n: number, codeTitle: string, hunks: readonly number[]) => ({
      ...step(n, "What a user sees", hunks, hunks),
      codeTitle,
    });
    const steps = [titled(3, "Page: Setup", [4]), titled(4, "Command: main in cli.py", [5])];
    const overview = opened(input(files, { callGraph: [call(4, 6), call(5, 6)] }), steps);
    const entries = new Map(overview.rows.flat().map((node) => [node.label, node.entries]));
    expect(entries.get("Setup.tsx")).toEqual(["Page: Setup"]);
    expect(entries.get("cli.py")).toEqual(["Command: main"]);
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

/** Uses of what hunk `n` changes, one per path, outside the pull request. */
const usedBy = (n: number, symbol: string, paths: readonly string[]): UnchangedCallers => ({
  partId: h(n),
  symbol,
  uses: paths.map((path) => ({
    path,
    line: 3,
    use: "call" as const,
    excerpt: { start: 1, lines: ["a", "b", symbol] },
  })),
  more: 0,
});

describe("fileOverview outside the pull request", () => {
  it("puts each caller file one row below the file it uses, with an outside edge", () => {
    const files = [file("app/main.py", [1]), file("app/store.py", [2])];
    const overview = opened(
      input(files, {
        callGraph: [call(1, 2)],
        unchangedCallers: [
          usedBy(2, "save", ["jobs/sync.py", "tests/test_sync.py"]),
          usedBy(1, "main", ["jobs/sync.py"]),
        ],
      }),
      tourOf(files),
    );
    expect(rowsOf(overview)).toEqual([["main.py"], ["store.py"], ["sync.py", "test_sync.py"]]);
    const sync = overview.rows[2]?.[0];
    expect(sync).toMatchObject({
      key: "outside:jobs/sync.py",
      kind: "outside",
      paths: ["jobs/sync.py"],
      partIds: [h(2), h(1)],
      uses: 2,
    });
    expect(
      overview.edges
        .filter((edge) => edge.outside)
        .map((edge) => [edge.from, edge.to, edge.symbols]),
    ).toEqual([
      ["outside:jobs/sync.py", "app/store.py", ["save"]],
      ["outside:jobs/sync.py", "app/main.py", ["main"]],
      ["outside:tests/test_sync.py", "app/store.py", ["save"]],
    ]);
    expect(overview.placeOf.has("jobs/sync.py")).toBe(false);
  });

  it("brings a file nothing in the pull request links into the diagram", () => {
    const files = [file("app/store.py", [1])];
    const overview = opened(
      input(files, { unchangedCallers: [usedBy(1, "save", ["jobs/sync.py"])] }),
      tourOf(files),
    );
    expect(rowsOf(overview)).toEqual([["store.py"], ["sync.py"]]);
    expect(overview.strip).toEqual([]);
  });

  it("groups more than ten caller files by directory", () => {
    const files = [file("app/store.py", [1])];
    const paths = [
      ...Array.from({ length: 10 }, (_, at) => `jobs/nightly/job${at}.py`),
      "scripts/one.py",
    ];
    const overview = opened(
      input(files, { unchangedCallers: [usedBy(1, "save", paths)] }),
      tourOf(files),
    );
    const outside = overview.rows[1] ?? [];
    expect(outside.map((node) => [node.key, node.label, node.paths.length, node.uses])).toEqual([
      ["outside:jobs/nightly/", "jobs/nightly/", 10, 10],
      ["outside:scripts/one.py", "one.py", 1, 1],
    ]);
  });

  it("leaves out callers of tests and helpers, which have no node", () => {
    const files = [file("app/store.py", [1]), file("tests/test_store.py", [2])];
    const overview = opened(
      input(files, {
        callGraph: [call(2, 1)],
        unchangedCallers: [usedBy(2, "make_store", ["tests/test_other.py"])],
      }),
      tourOf(files),
    );
    expect(overview.edges.some((edge) => edge.outside)).toBe(false);
  });
});

describe("fileOverview by directory", () => {
  const contract = (n: number): RiskAssessment => ({
    hunkId: h(n),
    riskClass: "contract",
    reason: "",
    source: "rule",
    lines: null,
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
    const overview = fileOverview(analysis, tourOf(files));
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

  it("merges the links between two directories into one edge, keeping its request", () => {
    const files = [
      file("web/Page.tsx", [1]),
      file("web/client.ts", [2]),
      file("api/routes.py", [3]),
      file("api/models.py", [4]),
    ];
    const overview = fileOverview(
      input(files, {
        callGraph: [
          call(1, 2),
          { ...call(2, 3, "GET /items"), use: "request" },
          { ...call(1, 4, "Item"), use: "type" },
        ],
      }),
      tourOf(files),
    );
    expect(overview.edges).toEqual([
      {
        from: "group:web",
        to: "group:api",
        uses: ["type", "request"],
        symbols: ["GET /items", "Item"],
        back: false,
        outside: false,
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
    const heavier = fileOverview(
      input(files, { fileLinks: [registers], callGraph: [call(3, 2), call(3, 1)] }),
      tourOf(files),
    );
    expect(rowsOf(heavier)).toEqual([["http/routes/"], ["http/"]]);
    expect(heavier.edges.filter((edge) => edge.back).map((edge) => edge.from)).toEqual([
      "group:http",
    ]);
    // On a tie, the edge into the directory read first points up, as for files.
    const tied = fileOverview(
      input(files, { fileLinks: [registers], callGraph: [call(3, 2)] }),
      tourOf(files),
    );
    expect(rowsOf(tied)).toEqual([["http/"], ["http/routes/"]]);
  });

  it("opens a directory in place to its files", () => {
    const files = [file("api/routes.py", [1]), file("api/models.py", [2]), file("svc/run.py", [3])];
    const overview = fileOverview(
      input(files, { callGraph: [call(1, 3), call(2, 3)] }),
      tourOf(files),
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
