import { describe, expect, it } from "vitest";
import {
  type CallGraphHint,
  type FileChange,
  type Hunk,
  HunkId,
  type HunkPart,
  PartId,
} from "../diff/index.ts";
import {
  type CodeFlowsInput,
  codeFlows,
  Flow,
  joinParts,
  looksGenerated,
  type RiskAssessment,
} from "./index.ts";

const h = (n: number): HunkId => HunkId.parse(`h_${n.toString(16).padStart(16, "0")}`);

/** Hunk n of `path`, adding `lines` at line n * 10. */
const hunk = (n: number, path: string, ...lines: string[]): Hunk => ({
  id: h(n),
  path,
  oldStart: n * 10,
  oldLines: 0,
  newStart: n * 10,
  newLines: Math.max(lines.length, 1),
  sectionHeading: null,
  lines: (lines.length > 0 ? lines : ["x"]).map((text, at) => ({
    kind: "add",
    oldLine: null,
    newLine: n * 10 + at,
    text,
    noNewlineAtEnd: false,
  })),
});

const file = (path: string, ...hunks: Hunk[]): FileChange => ({
  path,
  oldPath: null,
  status: "modified",
  binary: false,
  oldMode: null,
  newMode: null,
  language: null,
  hunks,
  additions: 0,
  deletions: 0,
});

/** A file with one hunk n of plain code. */
const one = (n: number, path: string, ...lines: string[]): FileChange =>
  file(path, hunk(n, path, ...lines));

const hint = (from: number, to: number, use: CallGraphHint["use"] = "call"): CallGraphHint => ({
  fromPartId: h(from),
  toPartId: h(to),
  symbol: `s${to}`,
  line: from * 10,
  use,
});

const contract = (...ns: number[]): RiskAssessment[] =>
  ns.map((n) => ({
    hunkId: h(n),
    riskClass: "contract",
    reason: "r",
    source: "rule",
    lines: null,
    guidance: null,
  }));

const all = (files: readonly FileChange[]) =>
  new Set(files.flatMap((f) => f.hunks.map((one) => one.id)));

/** Every part the flows read, sorted: each once when the flows place every part once. */
const placed = (flows: readonly Flow[]): PartId[] => flows.flatMap((flow) => flow.partIds).sort();

/** The parts of the required hunks, sorted: a hunk that isn't split is one part. */
const requiredParts = (required: ReadonlySet<HunkId>, parts: readonly HunkPart[]): PartId[] =>
  [...required]
    .flatMap((id): PartId[] => {
      const own = parts.filter((part) => part.hunkId === id).map((part) => part.id);
      return own.length > 0 ? own : [id];
    })
    .sort();

const flowsOf = (files: readonly FileChange[], options: Partial<CodeFlowsInput> = {}) => {
  const required = options.required ?? all(files);
  const flows = codeFlows({
    files,
    required,
    callGraph: [],
    risk: [],
    definitions: new Map(),
    ...options,
  });
  expect(placed(flows)).toEqual(requiredParts(required, options.parts ?? []));
  for (const flow of flows) expect(Flow.parse(flow)).toEqual(flow);
  return flows;
};

/** Each flow as its title and hunk numbers. */
const shape = (flows: readonly Flow[]) =>
  flows.map((flow) => [flow.title, flow.partIds.map((id) => Number.parseInt(id.slice(2), 16))]);

const route = (verb: string, path: string) => `@router.${verb}("${path}")`;

describe("codeFlows", () => {
  it("reads a route's flow from the entry down, callers before callees", () => {
    const files = [
      one(1, "api/routes.py", route("put", "/token")),
      one(2, "app/service.py"),
      one(3, "app/store.py"),
    ];
    const flows = flowsOf(files, { callGraph: [hint(1, 2), hint(2, 3)] });
    expect(shape(flows)).toEqual([["PUT /token", [1, 2, 3]]]);
    expect(flows[0]?.kind).toBe("flow");
  });

  it("reads the code that registers an entry first in its flow", () => {
    const files = [
      one(1, "api/app.py"),
      one(2, "api/routes.py", route("get", "/a")),
      one(3, "app/service.py"),
    ];
    const flows = flowsOf(files, { callGraph: [hint(1, 2), hint(2, 3)] });
    expect(shape(flows)).toEqual([["GET /a", [1, 2, 3]]]);
    // The flow starts at the route, not at the code that registers it.
    expect(flows[0]?.entries).toEqual([h(2)]);
  });

  it("reads shared code once before both consuming flows", () => {
    const files = [
      one(1, "api/a.py", route("get", "/a")),
      one(2, "api/b.py", route("get", "/b")),
      one(3, "app/shared.py"),
    ];
    const flows = flowsOf(files, { callGraph: [hint(1, 3), hint(2, 3)] });
    expect(shape(flows)).toEqual([
      ["Shared: app/shared.py", [3]],
      ["GET /a", [1]],
      ["GET /b", [2]],
    ]);
  });

  it("makes one flow of entry hunks that change the same definition", () => {
    const files = [file("tools/cli.py", hunk(1, "tools/cli.py"), hunk(2, "tools/cli.py"))];
    const definitions = new Map([
      [h(1), ["main"]],
      [h(2), ["main"]],
    ]);
    const flows = flowsOf(files, { definitions });
    expect(shape(flows)).toEqual([["Command: main in cli.py", [1, 2]]]);
    expect(flows[0]?.entries).toEqual([h(1), h(2)]);
  });

  it("orders flows that reach contract code first, then routes, pages, commands and roots", () => {
    const files = [
      one(1, "tools/cli.py"),
      one(2, "web/routes/Setup.tsx"),
      one(3, "api/routes.py", route("get", "/a")),
      one(4, "app/a.py"),
      one(5, "app/b.py"),
      one(6, "app/c.py"),
    ];
    const definitions = new Map([
      [h(1), ["main"]],
      [h(2), ["Setup"]],
      [h(4), ["helper"]],
    ]);
    const callGraph = [hint(4, 5), hint(1, 6)];
    expect(shape(flowsOf(files, { definitions, callGraph })).map(([title]) => title)).toEqual([
      "GET /a",
      "Page: Setup",
      "Command: main in cli.py",
      "helper in a.py",
    ]);
    expect(
      shape(flowsOf(files, { definitions, callGraph, risk: contract(5) })).map(([title]) => title),
    ).toEqual(["helper in a.py", "GET /a", "Page: Setup", "Command: main in cli.py"]);
  });

  it("titles a root without definitions by its path", () => {
    const files = [one(1, "app/a.py"), one(2, "app/b.py")];
    const flows = flowsOf(files, { callGraph: [hint(1, 2)] });
    expect(shape(flows)).toEqual([["app/a.py", [1, 2]]]);
    // A root isn't an entry point.
    expect(flows[0]?.entries).toEqual([]);
  });

  it("joins a root whose code another flow already read to that flow", () => {
    // A host class, reached through its base class, calls code the route's flow reads.
    const files = [
      one(1, "api/routes.py", route("get", "/a")),
      one(2, "app/hosts.py"),
      one(3, "app/keychain.py"),
      one(4, "app/github.py"),
    ];
    const callGraph = [hint(1, 2), hint(2, 3), hint(4, 3)];
    expect(shape(flowsOf(files, { callGraph }))).toEqual([["GET /a", [1, 2, 3, 4]]]);
  });

  it("attaches a type to the flow that uses it, and an import to its file's flow", () => {
    const files = [
      file("api/routes.py", hunk(1, "api/routes.py"), hunk(2, "api/routes.py", route("get", "/a"))),
      one(3, "api/models.py"),
      one(4, "app/service.py"),
    ];
    const callGraph = [hint(2, 4), hint(2, 3, "type")];
    expect(shape(flowsOf(files, { callGraph }))).toEqual([["GET /a", [1, 2, 4, 3]]]);
  });

  it("attaches tests through their calls, their file, their fakes and their subject", () => {
    const files = [
      one(1, "api/routes.py", route("get", "/a")),
      one(2, "app/keychain.py"),
      file("tests/test_api.py", hunk(3, "tests/test_api.py"), hunk(4, "tests/test_api.py")),
      one(5, "tests/fake_keychain.py"),
      one(6, "app/view.test.ts"),
      one(7, "app/view.ts"),
      one(8, "web/routes/Page.tsx"),
    ];
    const definitions = new Map([[h(8), ["Page"]]]);
    const callGraph = [hint(1, 2), hint(3, 1), hint(8, 7)];
    expect(shape(flowsOf(files, { callGraph, definitions }))).toEqual([
      ["GET /a", [1, 2, 3, 4, 5]],
      ["Page: Page", [8, 7, 6]],
    ]);
  });

  it("joins a doc to the code in its directory, and lists the rest as docs", () => {
    const files = [
      one(1, "api/routes.py", route("get", "/a")),
      one(2, "api/README.md"),
      one(3, "docs/guide.md"),
    ];
    expect(shape(flowsOf(files))).toEqual([
      ["GET /a", [1, 2]],
      ["Docs", [3]],
    ]);
  });

  it("puts what no flow runs into supporting flows, contract ones first", () => {
    const files = [
      one(1, "web/openapi.json"),
      one(2, "web/src/api/schema.d.ts"),
      one(3, "README.md"),
      one(4, "tests/test_misc.py"),
      one(5, "web/src/picker/Guide.tsx"),
      one(6, "scripts/build.sh"),
    ];
    const flows = flowsOf(files, {
      generated: new Set(["web/src/api/schema.d.ts"]),
      risk: contract(5),
    });
    expect(shape(flows)).toEqual([
      ["Other changes in web/src/picker", [5]],
      ["API schema", [1, 2]],
      ["Docs", [3]],
      ["Tests", [4]],
      ["Other changes in scripts", [6]],
    ]);
    expect(flows.every((flow) => flow.kind === "supporting" && flow.entries.length === 0)).toBe(
      true,
    );
  });

  it("keeps a generated file a flow only names as a type with the API schema", () => {
    const files = [one(1, "web/routes/Page.tsx"), one(2, "web/api/schema.d.ts")];
    const flows = flowsOf(files, {
      definitions: new Map([[h(1), ["Page"]]]),
      callGraph: [hint(1, 2, "type")],
      generated: new Set(["web/api/schema.d.ts"]),
    });
    expect(shape(flows)).toEqual([
      ["Page: Page", [1]],
      ["API schema", [2]],
    ]);
  });

  it("titles changes at the repository root as such", () => {
    expect(shape(flowsOf([one(1, "build.sh")]))).toEqual([
      ["Other changes in the repository root", [1]],
    ]);
  });

  it("reads a file's hunks together and in file order, and tests last", () => {
    const files = [
      file(
        "api/routes.py",
        hunk(1, "api/routes.py"),
        hunk(2, "api/routes.py", route("get", "/a")),
        hunk(3, "api/routes.py"),
      ),
      one(4, "app/service.py"),
      one(5, "tests/test_routes.py"),
    ];
    const callGraph = [hint(2, 4), hint(4, 3), hint(5, 2)];
    expect(shape(flowsOf(files, { callGraph }))).toEqual([["GET /a", [1, 2, 3, 4, 5]]]);
  });

  it("ignores hints to hunks that aren't required", () => {
    const files = [one(1, "api/routes.py", route("get", "/a")), one(2, "app/lock.json")];
    expect(shape(flowsOf(files, { callGraph: [hint(1, 2)], required: new Set([h(1)]) }))).toEqual([
      ["GET /a", [1]],
    ]);
  });

  it("is empty when nothing is required", () => {
    expect(flowsOf([one(1, "a.ts")], { required: new Set() })).toEqual([]);
  });

  it("reads a pull request shaped like delphi-code #2 as three flows and supporting ones", () => {
    const hosts = "app/infrastructure/hosts.py";
    const files = [
      one(1, "app/http_api/app.py"),
      one(
        2,
        "app/http_api/routes/hosting.py",
        route("get", "/api/account-connections"),
        route("put", "/api/account-connections/{domain}/token"),
        route("delete", "/api/account-connections/{domain}/token"),
      ),
      one(3, "app/http_api/request_models.py"),
      one(4, "app/services/application.py"),
      one(5, "app/services/remote.py"),
      file(hosts, hunk(6, hosts), hunk(7, hosts), hunk(8, hosts)),
      one(9, "app/infrastructure/keychain.py"),
      one(10, "tests/test_http_api.py"),
      one(11, "tests/fakes.py"),
      one(12, "tests/fake_keychain.py"),
      one(13, "web/src/routes/setup.tsx"),
      one(14, "web/src/setup/ConnectionsSection.tsx"),
      one(15, "web/src/api/schema.d.ts"),
      one(16, "web/openapi.json"),
      one(17, "web/src/routes/setup.test.tsx"),
      one(18, "CONTRIBUTING.md"),
      one(19, "web/src/picker/CredentialsGuide.tsx"),
    ];
    const callGraph = [
      hint(1, 2),
      hint(2, 4),
      hint(2, 3, "type"),
      hint(4, 5),
      hint(5, 6),
      hint(6, 9),
      // The Bitbucket host, reached through its base class.
      hint(7, 9),
      // main in hosts.py.
      hint(8, 6),
      hint(10, 2),
      hint(10, 11),
      hint(13, 14),
      hint(14, 15, "type"),
      // ConnectionsSection.tsx sends the three routes' requests; the test sends one.
      ...["GET /api/account-connections", "DELETE /api/account-connections/{domain}/token"].map(
        (symbol, at): CallGraphHint => ({ ...hint(14, 2, "request"), symbol, line: 141 + at }),
      ),
      {
        ...hint(14, 2, "request"),
        symbol: "PUT /api/account-connections/{domain}/token",
        line: 145,
      },
      { ...hint(10, 2, "request"), symbol: "GET /api/account-connections", line: 102 },
    ];
    const flows = flowsOf(files, {
      callGraph,
      definitions: new Map([
        [h(7), ["Bitbucket"]],
        [h(8), ["main"]],
        [h(13), ["SetupPage"]],
      ]),
      generated: new Set(["web/src/api/schema.d.ts"]),
      risk: contract(9, 16, 19),
    });
    expect(shape(flows)).toEqual([
      ["Shared: app/infrastructure/hosts.py", [6, 9, 12]],
      [
        "/api/account-connections: GET, PUT /{domain}/token, DELETE /{domain}/token",
        [1, 2, 4, 5, 7, 3, 10, 11],
      ],
      ["Command: main in hosts.py", [8]],
      ["Page: SetupPage", [13, 14, 17]],
      ["API schema", [15, 16]],
      ["Other changes in web/src/picker", [19]],
      ["Docs", [18]],
    ]);
  });

  it("covers every required hunk exactly once, over random pull requests", () => {
    // A small seeded generator, so a failure reproduces.
    let seed = 7;
    const next = (max: number): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return (seed >>> 16) % max;
    };
    const names = ["a.ts", "a.test.ts", "b.py", "README.md", "test_b.py", "openapi.json"];
    const lines = ["x", route("get", "/a"), 'app.post("/b", h)', "y"];
    for (let run = 0; run < 300; run += 1) {
      const files = Array.from({ length: 1 + next(8) }, (_, f) => {
        const path = `d${next(3)}/${f}${names[next(names.length)] ?? "x.ts"}`;
        return file(
          path,
          ...Array.from({ length: 1 + next(3) }, (_, i) =>
            hunk(f * 10 + i + 1, path, lines[next(lines.length)] ?? "x"),
          ),
        );
      });
      const ids = [...all(files)].map((id) => Number.parseInt(id.slice(2), 16));
      const pick = () => ids[next(ids.length)] ?? 1;
      const callGraph = Array.from({ length: next(14) }, () =>
        hint(pick(), pick(), next(3) === 0 ? "type" : "call"),
      );
      const definitions = new Map(ids.map((n) => [h(n), next(4) === 0 ? ["main"] : []]));
      flowsOf(files, {
        callGraph,
        definitions,
        risk: contract(...ids.filter(() => next(5) === 0)),
        required: new Set(ids.filter(() => next(4) !== 0).map(h)),
      });
    }
  });

  it("keeps shared components coherent, callers first, with associated tests", () => {
    const files = [
      one(1, "api/a.py", route("get", "/a")),
      one(2, "api/b.py", route("put", "/b")),
      one(3, "app/store.py"),
      one(4, "app/service.py"),
      one(5, "tests/test_service.py"),
      one(6, "app/schema.py"),
      one(7, "app/exclusive.py"),
    ];
    const flows = flowsOf(files, {
      callGraph: [
        hint(1, 4),
        hint(2, 4),
        hint(4, 3),
        hint(5, 4),
        hint(1, 6),
        hint(2, 6),
        hint(1, 7),
      ],
    });
    expect(shape(flows)).toEqual([
      ["Shared: app/service.py", [4, 3, 5]],
      ["Shared: app/schema.py", [6]],
      ["GET /a", [1, 7]],
      ["PUT /b", [2]],
    ]);
  });

  it("reads a shared section first, titled by where the flows enter it", () => {
    const flows = flowsOf(
      [
        one(1, "api/a.py", route("get", "/a")),
        one(2, "api/b.py", route("put", "/b")),
        one(3, "api/c.py", route("delete", "/c")),
        one(4, "app/refresh.py"),
        one(5, "app/read.py"),
      ],
      { callGraph: [hint(2, 4), hint(3, 4), hint(4, 5), hint(1, 5)] },
    );
    expect(shape(flows)[0]).toEqual(["Shared: app/refresh.py", [4, 5]]);
  });

  it("reads a shared call cycle once", () => {
    const flows = flowsOf(
      [
        one(1, "api/a.py", route("get", "/a")),
        one(2, "api/b.py", route("put", "/b")),
        one(3, "app/a.py"),
        one(4, "app/b.py"),
      ],
      { callGraph: [hint(1, 3), hint(2, 4), hint(3, 4), hint(4, 3)] },
    );

    expect(flows[0]?.partIds).toEqual([h(3), h(4)]);
    expect(flows[0]?.entries).toEqual([]);
  });
});

describe("codeFlows with parts", () => {
  // Shaped like delphi-code #2: one hunk adds a router and three routes on it, an app adds the
  // router, and the service and store each change one function per route.
  const p = (n: number, part: number): PartId => PartId.parse(`${h(n)}.${part}`);
  const partsOf = (n: number, ...lines: [number, number, string][]): HunkPart[] =>
    lines.map(([start, end, name], at) => ({
      id: p(n, at + 1),
      hunkId: h(n),
      start,
      end,
      definitions: [name],
    }));
  const files = [
    one(
      1,
      "api/routes.py",
      "changes = APIRouter()",
      route("get", "/items"),
      "def list_items(): return list_all()",
      '@changes.put("/items/{id}")',
      "def save_item(): return save()",
      '@changes.delete("/items/{id}")',
      "def forget_item(): return forget()",
    ),
    one(2, "api/app.py", "app.include_router(routes.changes)"),
    one(3, "app/service.py", "def list_all(): ...", "def save(): write()", "def forget(): erase()"),
    one(4, "app/store.py", "def write(): ...", "def erase(): ..."),
  ];
  const parts = [
    ...partsOf(
      1,
      [0, 1, "changes"],
      [1, 3, "list_items"],
      [3, 5, "save_item"],
      [5, 7, "forget_item"],
    ),
    ...partsOf(3, [0, 1, "list_all"], [1, 2, "save"], [2, 3, "forget"]),
    ...partsOf(4, [0, 1, "write"], [1, 2, "erase"]),
  ];
  const call = (from: PartId, to: PartId, line: number, symbol = "f"): CallGraphHint => ({
    fromPartId: from,
    toPartId: to,
    symbol,
    line,
    use: "call",
  });
  const callGraph = [
    call(p(1, 2), p(3, 1), 12),
    call(p(1, 3), p(1, 1), 13, "changes"),
    call(p(1, 3), p(3, 2), 14),
    call(p(1, 4), p(1, 1), 15, "changes"),
    call(p(1, 4), p(3, 3), 16),
    call(h(2), p(1, 1), 20, "changes"),
    call(p(3, 2), p(4, 1), 31),
    call(p(3, 3), p(4, 2), 32),
  ];
  const flows = flowsOf(files, { parts, callGraph });

  it("reads each route of a split hunk in its own flow, the router first in the first it registers", () => {
    expect(flows.map((flow) => [flow.title, flow.partIds])).toEqual([
      ["GET /items", [p(1, 2), p(3, 1)]],
      ["PUT /items/{id}", [h(2), p(1, 1), p(1, 3), p(3, 2), p(4, 1)]],
      ["DELETE /items/{id}", [p(1, 4), p(3, 3), p(4, 2)]],
    ]);
    expect(flows.map((flow) => flow.entries)).toEqual([[p(1, 2)], [p(1, 3)], [p(1, 4)]]);
  });

  describe("requests", () => {
    const request = (from: PartId, to: PartId, line: number, symbol: string): CallGraphHint => ({
      fromPartId: from,
      toPartId: to,
      symbol,
      line,
      use: "request",
    });
    // A page whose table sends the three routes' requests, and a test that calls GET's service
    // but sends PUT's request.
    const fullStack = [
      ...files,
      one(5, "web/src/routes/Items.tsx"),
      one(6, "web/src/items/ItemsTable.tsx"),
      one(7, "tests/test_items.py"),
    ];
    const requests = [
      ...callGraph,
      call(h(5), h(6), 50),
      request(h(5), p(1, 2), 51, "GET /items"),
      request(h(6), p(1, 2), 61, "GET /items"),
      request(h(6), p(1, 4), 62, "DELETE /items/{id}"),
      request(h(6), p(1, 3), 63, "PUT /items/{id}"),
      call(h(7), p(3, 1), 70),
      request(h(7), p(1, 3), 71, "PUT /items/{id}"),
    ];
    const withRequests = flowsOf(fullStack, {
      parts,
      callGraph: requests,
      definitions: new Map([[h(5), ["Items"]]]),
      // The table is contract, which would put the page's flow first.
      risk: contract(6),
    });

    it("passes through the routes a flow requests without walking into them", () => {
      const page = withRequests.find((flow) => flow.title === "Page: Items");
      expect(page?.partIds).toEqual([h(5), h(6)]);
    });

    it("puts a flow after the flows of the routes it requests", () => {
      expect(withRequests.map((flow) => flow.title)).toEqual([
        "GET /items",
        "PUT /items/{id}",
        "DELETE /items/{id}",
        "Page: Items",
      ]);
    });

    it("joins a test to the flow of the route it requests, before the code it calls", () => {
      expect(withRequests[1]?.partIds.at(-1)).toBe(h(7));
    });

    it("keeps a request cycle in order", () => {
      const cycle = flowsOf(fullStack, {
        parts,
        callGraph: [...requests, request(p(1, 2), h(6), 12, "GET /x")],
        definitions: new Map([[h(5), ["Items"]]]),
      });
      expect(cycle.map((flow) => flow.title)).toContain("Page: Items");
    });
  });

  it("joins back nothing when every part reads apart from its neighbors", () => {
    const joined = joinParts(flows, parts, callGraph);
    expect(joined.parts).toEqual(parts);
    expect(joined.flows).toEqual(flows);
    expect(placed(joined.flows)).toEqual(requiredParts(all(files), joined.parts));
  });

  it("doesn't take a part named on a route line, other than the router, for wiring", () => {
    const withModel = [
      ...callGraph,
      call(p(1, 2), p(3, 3), 11, "ItemsResponse"),
      call(p(1, 3), p(3, 3), 13, "ItemsResponse"),
    ];
    const read = flowsOf(files, { parts, callGraph: withModel });
    // ItemsResponse is named on GET's and PUT's route lines, but it's no router: it's code both
    // read, so it's shared, and GET still starts at its route.
    expect(read[0]?.title).toMatch(/^Shared: /);
    expect(read[0]?.partIds).toContain(p(3, 3));
    expect(read.map((flow) => [flow.title, flow.partIds[0]])).toContainEqual([
      "GET /items",
      p(1, 2),
    ]);
  });
});

describe("looksGenerated", () => {
  it.each([
    "/**\n * This file was auto-generated by openapi-typescript.\n */",
    "// Code generated by protoc-gen-go. DO NOT EDIT.",
    "# @generated by a tool",
  ])("says yes to %j", (content) => {
    expect(looksGenerated(content)).toBe(true);
  });

  it("reads only the first five lines", () => {
    expect(looksGenerated("a\nb\nc\nd\ne\n// @generated")).toBe(false);
    expect(looksGenerated("export const a = 1;")).toBe(false);
  });
});
