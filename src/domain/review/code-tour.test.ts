import { describe, expect, it } from "vitest";
import { type CallGraphHint, type FileChange, type Hunk, HunkId } from "../diff/index.ts";
import { codeTour, type RiskAssessment, Tour, validateTour } from "./index.ts";

const h = (n: number): HunkId => HunkId.parse(`h_${n.toString(16).padStart(16, "0")}`);

const hunk = (id: HunkId, path: string): Hunk => ({
  id,
  path,
  oldStart: 1,
  oldLines: 1,
  newStart: 1,
  newLines: 1,
  sectionHeading: null,
  lines: [{ kind: "add", oldLine: null, newLine: 1, text: "x", noNewlineAtEnd: false }],
});

const file = (path: string, ...ids: HunkId[]): FileChange => ({
  path,
  oldPath: null,
  status: "modified",
  binary: false,
  oldMode: null,
  newMode: null,
  language: null,
  hunks: ids.map((id) => hunk(id, path)),
  additions: ids.length,
  deletions: 0,
});

const calls = (from: HunkId, to: HunkId, symbol: string): CallGraphHint => ({
  fromHunkId: from,
  toHunkId: to,
  symbol,
});

const contract = (...ids: HunkId[]): RiskAssessment[] =>
  ids.map((hunkId) => ({ hunkId, riskClass: "contract", reason: "r", source: "rule" }));

const all = (files: readonly FileChange[]) =>
  new Set(files.flatMap((f) => f.hunks.map((one) => one.id)));

const tourOf = (
  files: readonly FileChange[],
  hints: readonly CallGraphHint[] = [],
  risk: readonly RiskAssessment[] = [],
  required = all(files),
) => {
  const tour = codeTour(files, required, hints, risk);
  expect(validateTour(tour, required)).toEqual([]);
  expect(Tour.parse(tour)).toEqual(tour);
  return tour;
};

const shape = (tour: Tour) => tour.steps.map((step) => [step.title, step.hunkIds]);

describe("codeTour", () => {
  it("reads a caller, its callee and the callee's test as one step", () => {
    const files = [
      file("src/auth/session.ts", h(2)),
      file("src/auth/session.test.ts", h(3)),
      file("src/api/routes.ts", h(1)),
    ];
    const tour = tourOf(files, [calls(h(1), h(2), "verifySession")]);

    expect(tour.builtBy).toBe("code");
    expect(tour.steps).toEqual([
      {
        id: "s1",
        title: "`verifySession`",
        explanation: "3 files in src/api and src/auth, tested in session.test.ts.",
        hunkIds: [h(1), h(2), h(3)],
      },
    ]);
  });

  it("titles a step by its longest chain, up to three symbols", () => {
    const files = ["a", "b", "c", "d", "e"].map((name, i) => file(`src/${name}.ts`, h(i + 1)));
    const hints = [
      calls(h(1), h(2), "b"),
      calls(h(2), h(3), "c"),
      calls(h(3), h(4), "d"),
      calls(h(4), h(5), "e"),
    ];
    expect(tourOf(files, hints).steps[0]?.title).toBe("`b` → `c` → `d` and 1 more");
  });

  it("names a pair of units by the first symbol between them", () => {
    const files = [file("src/a.ts", h(1)), file("src/b.ts", h(2))];
    const hints = [calls(h(1), h(2), "zeta"), calls(h(1), h(2), "alpha")];
    expect(tourOf(files, hints).steps[0]?.title).toBe("`alpha`");
  });

  it("makes a step per call chain, the one with contract hunks first", () => {
    const files = [
      file("src/a/caller.ts", h(1)),
      file("src/a/callee.ts", h(2)),
      file("src/z/caller.ts", h(3)),
      file("src/z/callee.ts", h(4)),
    ];
    const hints = [calls(h(1), h(2), "one"), calls(h(3), h(4), "two")];
    const tour = tourOf(files, hints, contract(h(4)));

    expect(shape(tour)).toEqual([
      ["`two`", [h(3), h(4)]],
      ["`one`", [h(1), h(2)]],
    ]);
  });

  it("starts a group at its entry points and reads callers before callees", () => {
    const files = [file("src/c.ts", h(3)), file("src/b.ts", h(2)), file("src/a.ts", h(1))];
    // c calls b, b calls a: c is the entry point even though a sorts first.
    const hints = [calls(h(3), h(2), "b"), calls(h(2), h(1), "a")];
    expect(tourOf(files, hints).steps[0]?.hunkIds).toEqual([h(3), h(2), h(1)]);
  });

  it("walks the riskier callee first", () => {
    const files = [file("src/main.ts", h(1)), file("src/a.ts", h(2)), file("src/b.ts", h(3))];
    const hints = [calls(h(1), h(2), "a"), calls(h(1), h(3), "b")];
    expect(tourOf(files, hints, contract(h(3))).steps[0]?.hunkIds).toEqual([h(1), h(3), h(2)]);
  });

  it("reads a cycle once, from its riskiest unit", () => {
    const files = [file("src/a.ts", h(1)), file("src/b.ts", h(2)), file("src/c.ts", h(3))];
    const hints = [calls(h(1), h(2), "b"), calls(h(2), h(3), "c"), calls(h(3), h(1), "a")];
    expect(tourOf(files, hints, contract(h(2))).steps[0]?.hunkIds).toEqual([h(2), h(3), h(1)]);
  });

  it("enters a cycle with a tail before the tail", () => {
    const files = [file("src/a.ts", h(1)), file("src/b.ts", h(2)), file("src/w.ts", h(3))];
    const hints = [calls(h(1), h(2), "b"), calls(h(2), h(1), "a"), calls(h(2), h(3), "w")];
    expect(tourOf(files, hints).steps[0]?.hunkIds).toEqual([h(1), h(2), h(3)]);
  });

  it("ignores hints within one unit", () => {
    const files = [file("src/a.ts", h(1), h(2)), file("src/a.test.ts", h(3))];
    const hints = [calls(h(1), h(2), "x"), calls(h(3), h(1), "a")];
    expect(shape(tourOf(files, hints))).toEqual([["src/a.ts", [h(1), h(2), h(3)]]]);
  });

  it("ignores hints to mechanical hunks", () => {
    const files = [file("src/a.ts", h(1)), file("src/b.ts", h(2))];
    const tour = tourOf(files, [calls(h(1), h(2), "b")], [], new Set([h(1)]));
    expect(shape(tour)).toEqual([["src/a.ts", [h(1)]]]);
  });

  it("groups unlinked files by area, a lone file by its path", () => {
    const files = [
      file("src/adapters/github/a.ts", h(1)),
      file("src/adapters/github/deep/b.ts", h(2)),
      file("web/src/diff/c.tsx", h(3)),
      file("README.md", h(4)),
    ];
    expect(shape(tourOf(files))).toEqual([
      ["README.md", [h(4)]],
      ["src/adapters/github", [h(1), h(2)]],
      ["web/src/diff/c.tsx", [h(3)]],
    ]);
  });

  it("titles a group at the repository root as such", () => {
    const files = [file("a.ts", h(1)), file("b.ts", h(2))];
    expect(tourOf(files).steps).toEqual([
      {
        id: "s1",
        title: "Repository root",
        explanation: "2 files in the repository root.",
        hunkIds: [h(1), h(2)],
      },
    ]);
  });

  it("puts steps with contract hunks first, most contract hunks first", () => {
    const files = [file("a/x.ts", h(1)), file("b/x.ts", h(2), h(3)), file("c/x.ts", h(4))];
    const tour = tourOf(files, [], contract(h(4), h(2), h(3)));
    expect(tour.steps.map((step) => step.title)).toEqual(["b/x.ts", "c/x.ts", "a/x.ts"]);
  });

  it.each([
    ["src/foo.ts", "src/foo.test.ts"],
    ["src/foo.tsx", "src/foo.spec.tsx"],
    ["src/foo.ts", "src/__tests__/foo.ts"],
    ["pkg/foo.go", "pkg/foo_test.go"],
    ["app/foo.py", "tests/test_foo.py"],
    ["app/foo.py", "app/test_foo.py"],
    ["src/main/java/Foo.java", "src/test/java/FooTest.java"],
    ["lib/foo.rb", "spec/lib/foo_spec.rb"],
  ])("pairs %s with its test %s", (subject, test) => {
    const files = [file(test, h(2)), file(subject, h(1))];
    expect(tourOf(files).steps.map((step) => step.hunkIds)).toEqual([[h(1), h(2)]]);
  });

  it("pairs a test with the subject closest to it", () => {
    const files = [file("a/foo.ts", h(1)), file("b/c/foo.ts", h(2)), file("b/c/foo.test.ts", h(3))];
    const tour = tourOf(files);
    expect(tour.steps.find((step) => step.hunkIds.includes(h(3)))?.hunkIds).toEqual([h(2), h(3)]);
  });

  it("keeps a test whose subject isn't in the pull request on its own", () => {
    const files = [file("src/a.ts", h(1)), file("src/b.test.ts", h(2))];
    expect(tourOf(files).steps).toEqual([
      {
        id: "s1",
        title: "src",
        explanation: "2 files in src, tested in b.test.ts.",
        hunkIds: [h(1), h(2)],
      },
    ]);
  });

  it("keeps a test of a subject with only mechanical hunks on its own", () => {
    const files = [file("src/a.ts", h(1)), file("src/a.test.ts", h(2)), file("src/z.ts", h(3))];
    const tour = tourOf(files, [], [], new Set([h(2), h(3)]));
    expect(tour.steps.flatMap((step) => step.hunkIds)).toEqual([h(2), h(3)]);
  });

  it("joins a doc to the one code file in its directory", () => {
    const files = [
      file("src/a/README.md", h(1)),
      file("src/a/x.ts", h(2)),
      file("src/b/README.md", h(3)),
      file("src/b/y.ts", h(4)),
      file("src/b/z.ts", h(5)),
      file("src/c/y.ts", h(6)),
    ];
    const hints = [calls(h(2), h(6), "y"), calls(h(4), h(6), "y")];
    const tour = tourOf(files, hints);
    // src/a/README.md travels with x.ts; src/b/README.md has two neighbours, so it stays apart.
    expect(tour.steps[0]?.hunkIds).toEqual([h(2), h(1), h(6), h(4)]);
    expect(tour.steps.slice(1).map((step) => step.hunkIds)).toEqual([[h(3), h(5)]]);
  });

  it("lists at most three directories and test files", () => {
    const files = ["a", "b", "c", "d", "e"].flatMap((dir, i) => [
      file(`${dir}/x.ts`, h(i * 2 + 1)),
      file(`${dir}/x.test.ts`, h(i * 2 + 2)),
    ]);
    const hints = ["b", "c", "d", "e"].map((_, i) => calls(h(1), h(i * 2 + 3), "x"));
    expect(tourOf(files, hints).steps[0]?.explanation).toBe(
      "10 files in a, b, c and 2 more, tested in x.test.ts, x.test.ts, x.test.ts and 2 more.",
    );
  });

  it("is empty when nothing is required", () => {
    expect(codeTour([file("a.ts", h(1))], new Set(), [], [])).toEqual({
      steps: [],
      builtBy: "code",
    });
  });

  it("covers every required hunk exactly once, over random pull requests", () => {
    // A small seeded generator, so a failure reproduces.
    let seed = 7;
    const next = (max: number): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return (seed >>> 16) % max;
    };
    const names = ["a.ts", "a.test.ts", "b.ts", "README.md", "test_b.py", "b.py"];
    for (let run = 0; run < 200; run += 1) {
      const files = Array.from({ length: 1 + next(8) }, (_, f) =>
        file(
          `d${next(3)}/${f}${names[next(names.length)] ?? "x.ts"}`,
          ...Array.from({ length: 1 + next(3) }, (_, i) => h(f * 10 + i + 1)),
        ),
      );
      const ids = [...all(files)];
      const hints = Array.from({ length: next(12) }, () =>
        calls(ids[next(ids.length)] ?? h(1), ids[next(ids.length)] ?? h(1), `s${next(4)}`),
      );
      const required = new Set(ids.filter(() => next(4) !== 0));
      tourOf(files, hints, contract(...ids.filter(() => next(5) === 0)), required);
    }
  });
});
