import { describe, expect, it } from "vitest";
import { hunk } from "../../application/testing/index.ts";
import type { Hunk, HunkId } from "../diff/index.ts";
import { keptSteps, type StepContext, type StepDraft, validateSteps } from "./index.ts";

const lines = (count: number, prefix = "+") =>
  Array.from({ length: count }, (_, at) => `${prefix}line ${at + 1}`);

const client = hunk("web/src/api/tokens.ts", "@@ -0,0 +1,10 @@", lines(10));
const route = hunk("app/routes/tokens.py", "@@ -0,0 +1,12 @@", lines(12));
const keychain = hunk("app/infra/keychain.py", "@@ -1,6 +1,6 @@", [
  " def read():",
  "-    return run(cmd)",
  "+    return run(cmd, timeout=5)",
  " ",
  " def write():",
  "-    run(cmd)",
  "+    run(cmd, timeout=5)",
  " ",
]);
const lockfile = hunk("pnpm-lock.yaml", "@@ -1,2 +1,2 @@", ["-a: 1", "+a: 2", " b: 1"]);
const routeAgain = hunk("app/routes/tokens.py", "@@ -40,2 +52,3 @@", [" x", "+y", " z"]);

const hunks = new Map<HunkId, Hunk>(
  [client, route, keychain, lockfile, routeAgain].map((one) => [one.id, one]),
);

const context = (overrides: Partial<StepContext> = {}): StepContext => ({
  hunks,
  mechanical: new Set([lockfile.id]),
  ...overrides,
});

const on = (one: Hunk, startLine: number, line: number, side: "new" | "old" = "new") => ({
  hunkId: one.id,
  side,
  startLine,
  line,
});

const step = (...excerpts: StepDraft["excerpts"]): StepDraft => ({
  sentence: "A token is saved",
  excerpts,
});

const tour = [
  step(on(client, 1, 8), on(route, 2, 10)),
  step(on(keychain, 2, 3)),
  step(on(keychain, 6, 6)),
];

describe("validateSteps", () => {
  it("finds nothing wrong with steps on lines their hunks show, whatever their order", () => {
    expect(validateSteps(tour, context())).toEqual([]);
  });

  it("takes an excerpt of removed lines on the base side", () => {
    expect(validateSteps([step(on(keychain, 2, 2, "old"))], context())).toEqual([]);
  });

  it("finds excerpts on an unknown hunk, a proved hunk and lines a hunk doesn't show", () => {
    const stray = { ...on(client, 1, 2), hunkId: "h_0000000000000000" as HunkId };
    expect(
      validateSteps(
        [
          step(stray),
          step(on(lockfile, 1, 1)),
          step(on(client, 9, 11)),
          step(on(keychain, 7, 7, "old")),
        ],
        context(),
      ),
    ).toEqual([
      { kind: "unknown-hunk", step: 0, excerpt: 0, hunkId: stray.hunkId },
      { kind: "mechanical", step: 1, excerpt: 0, hunkId: lockfile.id },
      { kind: "lines-outside", step: 2, excerpt: 0, hunkId: client.id },
      { kind: "lines-outside", step: 3, excerpt: 0, hunkId: keychain.id },
    ]);
  });

  it("takes two excerpts in one file, in one hunk too, when they share no line", () => {
    expect(
      validateSteps(
        [step(on(route, 1, 4), on(routeAgain, 53, 53)), step(on(route, 1, 4), on(route, 5, 8))],
        context(),
      ),
    ).toEqual([]);
  });

  it("finds a step whose two excerpts show some of the same lines, on either side", () => {
    expect(
      validateSteps(
        [
          step(on(route, 1, 4), on(route, 4, 8)),
          step(on(keychain, 2, 2, "old"), on(keychain, 1, 2)),
          step(on(keychain, 2, 2, "old"), on(keychain, 6, 6)),
        ],
        context(),
      ),
    ).toEqual([
      { kind: "overlap", step: 0 },
      { kind: "overlap", step: 1 },
    ]);
  });

  it("finds every step past the seventh", () => {
    const many = Array.from({ length: 9 }, () => step(on(client, 1, 4)));
    expect(validateSteps(many, context())).toEqual([
      { kind: "too-many", step: 7 },
      { kind: "too-many", step: 8 },
    ]);
  });
});

describe("keptSteps", () => {
  it("numbers the steps in tour order", () => {
    expect(keptSteps(tour, []).map((kept) => kept.id)).toEqual(["t1", "t2", "t3"]);
  });

  it("drops bad excerpts, steps left with none, a second excerpt on the same lines and steps past seven", () => {
    const many = [
      step(on(lockfile, 1, 1), on(client, 1, 4)),
      step(on(client, 9, 11)),
      step(on(route, 1, 4), on(route, 3, 6)),
      ...Array.from({ length: 6 }, () => step(on(keychain, 2, 3))),
    ];
    const kept = keptSteps(many, validateSteps(many, context()));
    expect(kept.map((one) => one.excerpts)).toEqual([
      [on(client, 1, 4)],
      [on(route, 1, 4)],
      [on(keychain, 2, 3)],
      [on(keychain, 2, 3)],
      [on(keychain, 2, 3)],
      [on(keychain, 2, 3)],
    ]);
    expect(kept.at(-1)?.id).toBe("t6");
  });
});
