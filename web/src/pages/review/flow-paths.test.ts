import { describe, expect, it } from "vitest";
import {
  type CallGraphHint,
  type DefinitionCalls,
  type FileChange,
  HunkId,
  type UnchangedCallers,
} from "../../../../src/domain/diff/index.ts";
import type { Flow } from "../../../../src/domain/review/index.ts";
import { bowTie } from "./flow-bow-tie.ts";
import { type FlowPaths, type FlowPathsInput, filesOf, flowPaths } from "./flow-paths.ts";

const h = (n: number) => HunkId.parse(`h_${n.toString(16).padStart(16, "0")}`);

/** A file with one hunk per number in `ids`. */
const file = (
  path: string,
  ids: readonly number[],
  more: Partial<Pick<FileChange, "status" | "language">> = {},
): FileChange => ({
  path,
  oldPath: null,
  status: "modified",
  binary: false,
  oldMode: null,
  newMode: null,
  language: "java",
  hunks: ids.map((n) => ({
    id: h(n),
    path,
    oldStart: n * 10,
    oldLines: 0,
    newStart: n * 10,
    newLines: 1,
    sectionHeading: null,
    lines: [
      { kind: "add" as const, oldLine: null, newLine: n * 10, text: "x", noNewlineAtEnd: false },
    ],
  })),
  additions: ids.length,
  deletions: 0,
  ...more,
});

const hint = (from: number, to: number, use: CallGraphHint["use"] = "call"): CallGraphHint => ({
  fromPartId: h(from),
  toPartId: h(to),
  symbol: use === "request" ? "POST /orders" : `f${to}`,
  line: from * 10 + to,
  use,
});

const flow = (title: string, hunks: readonly number[], entries: readonly number[] = []): Flow => ({
  title,
  partIds: hunks.map(h),
  kind: "flow",
  entries: entries.map(h),
});

const input = (
  files: readonly FileChange[],
  more: Partial<FlowPathsInput> = {},
): FlowPathsInput => ({
  files,
  proofs: [],
  parts: [],
  callGraph: [],
  generated: [],
  flows: [],
  ...more,
});

const shape = ({ paths }: FlowPaths) =>
  paths.map((path) => [path.labels.join(" + "), ...path.stops.map((stop) => stop.label)]);

// A controller, a service and a repository, with the service's test and a README.
const controller = file("src/main/java/shop/controllers/OrderController.java", [1, 2]);
const service = file("src/main/java/shop/services/OrderService.java", [3, 4]);
const repository = file("src/main/java/shop/repositories/OrderRepository.java", [5], {
  status: "added",
});
const test = file("src/test/java/shop/services/OrderServiceTest.java", [6]);
const readme = file("README.md", [7], { language: null });
const config = file("src/main/resources/application.yml", [8], { language: null });
const shop = [controller, service, repository, test, readme, config];
const calls = [hint(1, 3), hint(3, 5), hint(2, 4), hint(6, 3)];

describe("flowPaths", () => {
  it("runs each flow from its entry through the changed files its calls reach", () => {
    const paths = flowPaths(
      input(shop, {
        callGraph: calls,
        flows: [flow("POST /orders", [1], [1]), flow("GET /orders/{id}", [2], [2])],
      }),
    );
    expect(shape(paths)).toEqual([
      ["POST /orders", "OrderController", "OrderService", "OrderRepository"],
      ["GET /orders/{id}", "OrderController", "OrderService"],
    ]);
    expect(paths.paths[0]?.stops.map((stop) => [stop.status, stop.shared])).toEqual([
      ["changed", 2],
      ["changed", 2],
      ["new", 1],
    ]);
  });

  it("orders the directories callers first", () => {
    const paths = flowPaths(
      input(shop, { callGraph: calls, flows: [flow("POST /orders", [1], [1])] }),
    );
    expect(paths.layers.map((layer) => layer.label)).toEqual([
      "controllers",
      "services",
      "repositories",
    ]);
  });

  it("keeps tests, docs and other files off the paths, and loses no file", () => {
    const paths = flowPaths(
      input(shop, { callGraph: calls, flows: [flow("POST /orders", [1], [1])] }),
    );
    expect(paths.also).toEqual({
      tests: [test.path],
      docs: [readme.path],
      generated: [],
      mechanical: [],
      other: [config.path],
    });
    expect(paths.paths.flatMap((path) => path.stops).map((stop) => stop.path)).not.toContain(
      test.path,
    );
    expect(filesOf(paths).sort()).toEqual(shop.map((one) => one.path).sort());
  });

  it("lists changed code no path runs as unreached", () => {
    const paths = flowPaths(input(shop, { flows: [flow("POST /orders", [1], [1])] }));
    expect(shape(paths)).toEqual([["POST /orders", "OrderController"]]);
    expect(paths.unreached.map((stop) => stop.label)).toEqual(["OrderRepository", "OrderService"]);
    expect(filesOf(paths).sort()).toEqual(shop.map((one) => one.path).sort());
  });

  it("runs a shared section on each path that calls it, and makes no path of it", () => {
    const paths = flowPaths(
      input(shop, {
        callGraph: calls,
        flows: [
          flow("Shared: OrderService", [3, 4, 5]),
          flow("POST /orders", [1], [1]),
          flow("GET /orders/{id}", [2], [2]),
        ],
      }),
    );
    expect(paths.paths.map((path) => path.labels)).toEqual([
      ["POST /orders"],
      ["GET /orders/{id}"],
    ]);
    expect(paths.unreached).toEqual([]);
  });

  // A recorder the pull request adds, one part: one method answers a question, another writes a
  // profile. The encoder asks the question.
  const encoder = file("src/code/Encoder.java", [1]);
  const recorder = file("src/pgo/Recorder.java", [2], { status: "added" });
  const writer = file("src/pgo/Writer.java", [3], { status: "added" });
  const feature = file("src/hosted/Feature.java", [4], { status: "added" });
  const defines = (name: string, n: number, calls: readonly number[] = []): DefinitionCalls => ({
    name,
    partIds: [h(n)],
    calls,
    requests: [],
  });
  const profiling = [
    defines("encode", 1, [1]),
    defines("needsSignatures", 2),
    defines("dump", 2, [3]),
    defines("write", 3),
    defines("enable", 4, [1, 5]),
    defines("register", 4, [2]),
  ];

  it("reaches the method a call names and what that calls, not the rest of its class", () => {
    const paths = flowPaths(
      input([encoder, recorder, writer], { definitionCalls: profiling.slice(0, 4) }),
    );
    expect(shape(paths)).toEqual([
      ["encode in Encoder.java", "Encoder", "Recorder"],
      ["dump in Recorder.java", "Recorder", "Writer"],
    ]);
    expect(paths.paths[0]?.stops[1]?.names).toEqual(["needsSignatures"]);
    expect(paths.unreached).toEqual([]);
  });

  it("starts a path at a file's definitions nothing in the pull request calls", () => {
    const paths = flowPaths(
      input([encoder, recorder, writer, feature], { definitionCalls: profiling }),
    );
    // A path that runs no file another doesn't is drawn once: Recorder's own is on Feature's.
    expect(shape(paths)).toEqual([
      ["enable in Feature.java", "Feature", "Recorder", "Writer"],
      ["encode in Encoder.java", "Encoder", "Recorder"],
    ]);
  });

  it("names at most three of the definitions a path starts at", () => {
    const starts = ["a", "b", "c", "d"].map((name) => defines(name, 4, [4]));
    const paths = flowPaths(
      input([feature, writer], { definitionCalls: [...starts, defines("write", 3)] }),
    );
    expect(shape(paths)).toEqual([["a, b, c and 1 more in Feature.java", "Feature", "Writer"]]);
  });

  it("starts a path in a circle of calls, which nothing outside it calls", () => {
    const paths = flowPaths(
      input([recorder, writer], {
        definitionCalls: [defines("record", 2, [1]), defines("write", 3, [0])],
      }),
    );
    expect(shape(paths)).toEqual([["record in Recorder.java", "Recorder", "Writer"]]);
  });

  it("starts where the code outside any definition calls, and names the file", () => {
    const paths = flowPaths(
      input([encoder, writer], { definitionCalls: [defines("", 1, [1]), defines("write", 3)] }),
    );
    expect(shape(paths)).toEqual([["Encoder.java", "Encoder", "Writer"]]);
  });

  it("takes a part no definition is in as one by itself", () => {
    const paths = flowPaths(
      input([encoder, recorder, writer], {
        definitionCalls: profiling.slice(0, 2),
        flows: [flow("Command: main", [3], [3])],
      }),
    );
    expect(shape(paths)).toEqual([
      ["Command: main", "Writer"],
      ["encode in Encoder.java", "Encoder", "Recorder"],
    ]);
  });

  it("draws every link a path has from a call, and no other", () => {
    const ledger = file("src/pgo/Ledger.java", [5]);
    const helper = file("src/pgo/Helper.java", [6]);
    const orphan = file("src/pgo/Orphan.java", [7]);
    const files = [encoder, recorder, writer, feature, ledger, helper, orphan];
    const definitionCalls = [
      defines("enable", 4, [1, 3, 4]),
      defines("record", 2, [2, 3]),
      defines("write", 3, [4, 1]),
      defines("post", 5),
      defines("help", 6, [0]),
      defines("encode", 1, [1]),
      defines("orphan", 7),
    ];
    const found = flowPaths(
      input(files, {
        definitionCalls,
        flows: [flow("POST /orders", [4, 7], [4]), flow("GET /orders", [1, 7], [1])],
      }),
    );
    const pathOfPart = new Map<string, string>(
      files.flatMap((one) => one.hunks.map((each) => [each.id, one.path])),
    );
    const pathOf = (one: DefinitionCalls | undefined) => pathOfPart.get(one?.partIds[0] ?? h(0));
    const made = new Set(
      definitionCalls.flatMap((one) =>
        one.calls.map((to) => `${pathOf(one)}>${pathOf(definitionCalls[to])}`),
      ),
    );
    const key = ({ from, to }: { from: string | null; to: string }) => `${from}>${to}`;
    expect(found.paths.map((path) => path.labels)).toEqual([["POST /orders"], ["GET /orders"]]);
    for (const path of found.paths) {
      expect(path.calls.map(key).filter((call) => !made.has(call))).toEqual([]);
      const called = path.stops.filter((one) => one.from !== null);
      const drawn = new Set(path.calls.map(key));
      expect(called.filter((one) => !drawn.has(key({ from: one.from, to: one.path })))).toEqual([]);
      // Where it starts is the one stop nothing on it leads to.
      expect(path.stops.length - called.length).toBe(1);
    }
    expect(found.calls.map(key).filter((call) => !made.has(call))).toEqual([]);
    // A file a flow only lists is no stop.
    expect(found.unreached.map((one) => one.path)).toEqual([orphan.path]);
  });

  it("draws a stop under the caller nearest the start, and says every caller", () => {
    const [path] = flowPaths(
      input([encoder, recorder, writer], {
        definitionCalls: [
          defines("encode", 1, [1, 2]),
          defines("record", 2, [2]),
          defines("write", 3),
        ],
      }),
    ).paths;
    expect(path?.stops.map((one) => [one.label, one.from, one.calledBy])).toEqual([
      ["Encoder", null, []],
      ["Recorder", encoder.path, ["Encoder"]],
      ["Writer", encoder.path, ["Encoder", "Recorder"]],
    ]);
  });

  it("joins the paths that run the same files into one, with each label", () => {
    const paths = flowPaths(
      input([controller, service], {
        callGraph: [hint(1, 3), hint(2, 3)],
        flows: [flow("POST /orders", [1], [1]), flow("PUT /orders/{id}", [2], [2])],
      }),
    );
    expect(shape(paths)).toEqual([
      ["POST /orders + PUT /orders/{id}", "OrderController", "OrderService"],
    ]);
  });

  it("says in how many places code outside uses a stop, and starts no path there", () => {
    const at = (path: string) => ({
      path,
      line: 12,
      use: "call" as const,
      excerpt: { start: 12, lines: ["place()"] },
    });
    const callers: UnchangedCallers[] = [
      {
        partId: h(3),
        symbol: "place",
        uses: [
          at("src/main/java/shop/jobs/RefundJob.java"),
          at("src/main/java/shop/jobs/RetryJob.java"),
          at("src/test/java/shop/jobs/RefundJobTest.java"),
        ],
        more: 0,
      },
    ];
    const flows = [flow("POST /orders", [1], [1])];
    const paths = flowPaths(input(shop, { callGraph: calls, flows, unchangedCallers: callers }));
    expect(shape(paths)).toEqual(shape(flowPaths(input(shop, { callGraph: calls, flows }))));
    expect(paths.paths[0]?.stops.map((one) => [one.label, one.uses])).toEqual([
      ["OrderController", 0],
      ["OrderService", 2],
      ["OrderRepository", 0],
    ]);
  });

  it("ends a path in the requests it sends, without following them", () => {
    const page = file("web/src/pages/Orders.tsx", [9], { language: "tsx" });
    const paths = flowPaths(
      input([page, controller, service], {
        callGraph: [hint(9, 1, "request"), hint(1, 3)],
        flows: [flow("Page: Orders", [9], [9]), flow("POST /orders", [1], [1])],
      }),
    );
    expect(shape(paths)[0]).toEqual(["Page: Orders", "Orders"]);
    expect(paths.paths[0]?.ends).toEqual([
      { label: "POST /orders", partId: h(1), from: page.path },
    ]);
  });

  it("lists a file proved mechanical in every hunk apart, and never as a stop", () => {
    const paths = flowPaths(
      input(shop, {
        callGraph: calls,
        flows: [flow("POST /orders", [1], [1])],
        proofs: [
          { kind: "whitespace", hunkId: h(5), path: repository.path, detail: "whitespace only" },
        ],
      }),
    );
    expect(paths.also.mechanical).toEqual([repository.path]);
    expect(shape(paths)).toEqual([["POST /orders", "OrderController", "OrderService"]]);
  });
});

describe("bowTie", () => {
  const paths = flowPaths(
    input(shop, {
      callGraph: calls,
      flows: [flow("POST /orders", [1], [1]), flow("GET /orders/{id}", [2], [2])],
    }),
  );
  const tie = bowTie(paths);
  const label = (key: string) => tie.nodes.find((node) => node.key === key)?.label;

  it("puts paths on the left, files that call on in the middle and the rest on the right", () => {
    expect(tie.nodes.map((node) => [node.column, node.label])).toEqual([
      [0, "POST /orders"],
      [0, "GET /orders/{id}"],
      [1, "OrderService"],
      [2, "OrderRepository"],
    ]);
  });

  it("links a path to what it runs through, and that to what it ends in", () => {
    expect(tie.edges.map((edge) => [label(edge.from), label(edge.to)])).toEqual([
      ["POST /orders", "OrderService"],
      ["OrderService", "OrderRepository"],
      ["GET /orders/{id}", "OrderService"],
    ]);
  });

  it("links two files of the middle, the one that calls to the one it calls", () => {
    const refunds = file("src/main/java/shop/refunds/RefundService.java", [9]);
    const chain = bowTie(
      flowPaths(
        input([controller, service, refunds, repository], {
          callGraph: [hint(1, 3), hint(3, 9), hint(9, 5)],
          flows: [flow("POST /orders", [1], [1])],
        }),
      ),
    );
    const name = (key: string) => chain.nodes.find((node) => node.key === key)?.label;
    expect(chain.nodes.map((node) => [node.column, node.label])).toEqual([
      [0, "POST /orders"],
      [1, "OrderService"],
      [1, "RefundService"],
      [2, "OrderRepository"],
    ]);
    expect(chain.edges.map((edge) => [name(edge.from), name(edge.to)])).toEqual([
      ["POST /orders", "OrderService"],
      ["OrderService", "RefundService"],
      ["RefundService", "OrderRepository"],
    ]);
  });

  it("links a request to the file that sends it, which is in the middle", () => {
    const page = file("web/src/pages/Orders.tsx", [9], { language: "tsx" });
    const client = file("web/src/api/orders.ts", [10], { language: "typescript" });
    const sent = bowTie(
      flowPaths(
        input([page, client, controller], {
          callGraph: [hint(9, 10), hint(10, 1, "request")],
          flows: [flow("Page: Orders", [9], [9])],
        }),
      ),
    );
    const name = (key: string) => sent.nodes.find((node) => node.key === key)?.label;
    expect(sent.edges.map((edge) => [name(edge.from), name(edge.to)])).toEqual([
      ["Page: Orders", "orders"],
      ["orders", "POST /orders"],
    ]);
  });

  it("links a path straight to an end it calls itself", () => {
    const direct = bowTie(
      flowPaths(
        input([controller, repository], {
          callGraph: [hint(1, 5)],
          flows: [flow("POST /orders", [1], [1])],
        }),
      ),
    );
    expect(direct.nodes.map((node) => node.column)).toEqual([0, 2]);
    expect(direct.edges).toHaveLength(1);
  });

  it("opens a directory to a box per file, each with its own links", () => {
    const refunds = file("src/main/java/shop/services/RefundService.java", [9]);
    const ledger = file("src/main/java/shop/ledger/Ledger.java", [10]);
    const several = flowPaths(
      input([controller, service, refunds, repository, ledger], {
        callGraph: [hint(1, 3), hint(1, 9), hint(3, 5), hint(9, 10)],
        flows: [flow("POST /orders", [1], [1])],
      }),
    );
    const linksOf = (tie: ReturnType<typeof bowTie>) => {
      const name = (key: string) => tie.nodes.find((node) => node.key === key)?.label;
      return tie.edges.map((edge) => [name(edge.from), name(edge.to)]);
    };
    const closed = bowTie(several);
    const [box] = closed.nodes.filter((node) => node.stops.length > 1);
    expect(box).toMatchObject({ column: 1, label: "services/", note: "2 files" });
    expect(closed.opened).toEqual([]);

    const opened = bowTie(several, new Set([box?.group ?? ""]));
    expect(opened.opened).toEqual([{ key: box?.group, column: 1, label: "services/" }]);
    expect(
      opened.nodes
        .filter((node) => node.column === 1)
        .map((node) => [node.label, node.note, node.group]),
    ).toEqual([
      ["OrderService", "services", box?.group],
      ["RefundService", "services", box?.group],
    ]);
    expect(linksOf(opened)).toEqual([
      ["POST /orders", "OrderService"],
      ["POST /orders", "RefundService"],
      ["OrderService", "OrderRepository"],
      ["RefundService", "Ledger"],
    ]);
  });

  it("keeps a box of one file as it is when it's asked to open", () => {
    const [box] = tie.nodes.filter((node) => node.column === 1);
    const asked = bowTie(paths, new Set([box?.group ?? ""]));
    expect(asked.nodes).toEqual(tie.nodes);
    expect(asked.opened).toEqual([]);
  });
});
