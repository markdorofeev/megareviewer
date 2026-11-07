import { describe, expect, it } from "vitest";
import { type CallGraphHint, type FileChange, type Hunk, HunkId } from "../diff/index.ts";
import {
  type CodeTourInput,
  codeTour,
  looksGenerated,
  type RiskAssessment,
  Tour,
  validateTour,
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

const hint = (from: number, to: number, use: "call" | "type" = "call"): CallGraphHint => ({
  fromHunkId: h(from),
  toHunkId: h(to),
  symbol: `s${to}`,
  line: from * 10,
  use,
});

const contract = (...ns: number[]): RiskAssessment[] =>
  ns.map((n) => ({ hunkId: h(n), riskClass: "contract", reason: "r", source: "rule" }));

const all = (files: readonly FileChange[]) =>
  new Set(files.flatMap((f) => f.hunks.map((one) => one.id)));

const tourOf = (files: readonly FileChange[], options: Partial<CodeTourInput> = {}) => {
  const required = options.required ?? all(files);
  const tour = codeTour({
    files,
    required,
    callGraph: [],
    risk: [],
    definitions: new Map(),
    ...options,
  });
  expect(validateTour(tour, required)).toEqual([]);
  expect(Tour.parse(tour)).toEqual(tour);
  // `via` only names hunks earlier steps read.
  tour.steps.forEach((step, at) => {
    const earlier = new Set(tour.steps.slice(0, at).flatMap((s) => s.hunkIds));
    for (const id of step.via) expect(earlier.has(id)).toBe(true);
  });
  return tour;
};

/** Each step as its title and hunk numbers. */
const shape = (tour: Tour) =>
  tour.steps.map((step) => [
    step.title,
    step.hunkIds.map((id) => Number.parseInt(id.slice(2), 16)),
  ]);

const route = (verb: string, path: string) => `@router.${verb}("${path}")`;

describe("codeTour", () => {
  it("reads a route's flow from the entry down, callers before callees", () => {
    const files = [
      one(1, "api/routes.py", route("put", "/token")),
      one(2, "app/service.py"),
      one(3, "app/store.py"),
    ];
    const tour = tourOf(files, { callGraph: [hint(1, 2), hint(2, 3)] });
    expect(shape(tour)).toEqual([["PUT /token", [1, 2, 3]]]);
    expect(tour.steps[0]?.kind).toBe("flow");
    expect(tour.steps[0]?.explanation).toBe("Reads routes.py, service.py and store.py.");
  });

  it("reads the code that registers an entry first in its flow", () => {
    const files = [
      one(1, "api/app.py"),
      one(2, "api/routes.py", route("get", "/a")),
      one(3, "app/service.py"),
    ];
    const tour = tourOf(files, { callGraph: [hint(1, 2), hint(2, 3)] });
    expect(shape(tour)).toEqual([["GET /a", [1, 2, 3]]]);
    // The flow starts at the route, not at the code that registers it.
    expect(tour.steps[0]?.entries).toEqual([h(2)]);
  });

  it("reads shared code in the first flow and points to it from the next", () => {
    const files = [
      one(1, "api/a.py", route("get", "/a")),
      one(2, "api/b.py", route("get", "/b")),
      one(3, "app/shared.py"),
    ];
    const tour = tourOf(files, { callGraph: [hint(1, 3), hint(2, 3)] });
    expect(shape(tour)).toEqual([
      ["GET /a", [1, 3]],
      ["GET /b", [2]],
    ]);
    expect(tour.steps[1]?.via).toEqual([h(3)]);
    expect(tour.steps[1]?.explanation).toBe("Reads b.py; passes through step 1.");
  });

  it("makes one flow of entry hunks that change the same definition", () => {
    const files = [file("tools/cli.py", hunk(1, "tools/cli.py"), hunk(2, "tools/cli.py"))];
    const definitions = new Map([
      [h(1), ["main"]],
      [h(2), ["main"]],
    ]);
    const tour = tourOf(files, { definitions });
    expect(shape(tour)).toEqual([["Command: main in cli.py", [1, 2]]]);
    expect(tour.steps[0]?.entries).toEqual([h(1), h(2)]);
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
    expect(shape(tourOf(files, { definitions, callGraph })).map(([title]) => title)).toEqual([
      "GET /a",
      "Page: Setup",
      "Command: main in cli.py",
      "helper in a.py",
    ]);
    expect(
      shape(tourOf(files, { definitions, callGraph, risk: contract(5) })).map(([title]) => title),
    ).toEqual(["helper in a.py", "GET /a", "Page: Setup", "Command: main in cli.py"]);
  });

  it("titles a root without definitions by its path", () => {
    const files = [one(1, "app/a.py"), one(2, "app/b.py")];
    const tour = tourOf(files, { callGraph: [hint(1, 2)] });
    expect(shape(tour)).toEqual([["app/a.py", [1, 2]]]);
    // A root isn't an entry point.
    expect(tour.steps[0]?.entries).toEqual([]);
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
    expect(shape(tourOf(files, { callGraph }))).toEqual([["GET /a", [1, 2, 3, 4]]]);
  });

  it("attaches a type to the flow that uses it, and an import to its file's flow", () => {
    const files = [
      file("api/routes.py", hunk(1, "api/routes.py"), hunk(2, "api/routes.py", route("get", "/a"))),
      one(3, "api/models.py"),
      one(4, "app/service.py"),
    ];
    const callGraph = [hint(2, 4), hint(2, 3, "type")];
    expect(shape(tourOf(files, { callGraph }))).toEqual([["GET /a", [1, 2, 4, 3]]]);
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
    expect(shape(tourOf(files, { callGraph, definitions }))).toEqual([
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
    expect(shape(tourOf(files))).toEqual([
      ["GET /a", [1, 2]],
      ["Docs", [3]],
    ]);
  });

  it("puts what no flow runs into supporting steps, contract ones first", () => {
    const files = [
      one(1, "web/openapi.json"),
      one(2, "web/src/api/schema.d.ts"),
      one(3, "README.md"),
      one(4, "tests/test_misc.py"),
      one(5, "web/src/picker/Guide.tsx"),
      one(6, "scripts/build.sh"),
    ];
    const tour = tourOf(files, {
      generated: new Set(["web/src/api/schema.d.ts"]),
      risk: contract(5),
    });
    expect(shape(tour)).toEqual([
      ["Other changes in web/src/picker", [5]],
      ["API schema", [1, 2]],
      ["Docs", [3]],
      ["Tests", [4]],
      ["Other changes in scripts", [6]],
    ]);
    expect(
      tour.steps.every((step) => step.kind === "supporting" && step.entries.length === 0),
    ).toBe(true);
    expect(tour.steps[1]?.explanation).toBe(
      "2 files: openapi.json and schema.d.ts. No flow runs them.",
    );
    expect(tour.steps[0]?.explanation).toBe("1 file: Guide.tsx. No flow runs it.");
  });

  it("keeps a generated file a flow only names as a type with the API schema", () => {
    const files = [one(1, "web/routes/Page.tsx"), one(2, "web/api/schema.d.ts")];
    const tour = tourOf(files, {
      definitions: new Map([[h(1), ["Page"]]]),
      callGraph: [hint(1, 2, "type")],
      generated: new Set(["web/api/schema.d.ts"]),
    });
    expect(shape(tour)).toEqual([
      ["Page: Page", [1]],
      ["API schema", [2]],
    ]);
  });

  it("titles changes at the repository root as such", () => {
    expect(shape(tourOf([one(1, "build.sh")]))).toEqual([
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
    expect(shape(tourOf(files, { callGraph }))).toEqual([["GET /a", [1, 2, 3, 4, 5]]]);
  });

  it("ignores hints to hunks that aren't required", () => {
    const files = [one(1, "api/routes.py", route("get", "/a")), one(2, "app/lock.json")];
    expect(shape(tourOf(files, { callGraph: [hint(1, 2)], required: new Set([h(1)]) }))).toEqual([
      ["GET /a", [1]],
    ]);
  });

  it("lists at most three files in an explanation", () => {
    const files = [
      one(1, "api/routes.py", route("get", "/a")),
      ...[2, 3, 4, 5].map((n) => one(n, `app/m${n}.py`)),
    ];
    const callGraph = [hint(1, 2), hint(2, 3), hint(3, 4), hint(4, 5)];
    expect(tourOf(files, { callGraph }).steps[0]?.explanation).toBe(
      "Reads routes.py, m2.py, m3.py and 2 more.",
    );
  });

  it("is empty when nothing is required", () => {
    expect(tourOf([one(1, "a.ts")], { required: new Set() })).toEqual({
      steps: [],
      builtBy: "code",
    });
  });

  it("reads a pull request shaped like delphi-code #2 as three flows and supporting steps", () => {
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
    ];
    const tour = tourOf(files, {
      callGraph,
      definitions: new Map([
        [h(7), ["Bitbucket"]],
        [h(8), ["main"]],
        [h(13), ["SetupPage"]],
      ]),
      generated: new Set(["web/src/api/schema.d.ts"]),
      risk: contract(9, 16, 19),
    });
    expect(shape(tour)).toEqual([
      [
        "/api/account-connections: GET, PUT /{domain}/token, DELETE /{domain}/token",
        [1, 2, 4, 5, 6, 7, 9, 3, 10, 11, 12],
      ],
      ["Command: main in hosts.py", [8]],
      ["Page: SetupPage", [13, 14, 17]],
      ["API schema", [15, 16]],
      ["Other changes in web/src/picker", [19]],
      ["Docs", [18]],
    ]);
    expect(tour.steps[1]?.via).toEqual([h(6), h(9)]);
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
      tourOf(files, {
        callGraph,
        definitions,
        risk: contract(...ids.filter(() => next(5) === 0)),
        required: new Set(ids.filter(() => next(4) !== 0).map(h)),
      });
    }
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
