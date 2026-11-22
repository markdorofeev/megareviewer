import { describe, expect, it } from "vitest";
import { hunk } from "../../application/testing/index.ts";
import { type CallGraphHint, type Hunk, type HunkId, PartId } from "../diff/index.ts";
import { keptStops, type StopContext, type StopDraft, validateStops } from "./index.ts";

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

const call = (from: Hunk | PartId, to: Hunk | PartId, use: CallGraphHint["use"] = "call") => ({
  fromPartId: typeof from === "string" ? from : from.id,
  toPartId: typeof to === "string" ? to : to.id,
  symbol: "name",
  line: 1,
  use,
});

const context = (overrides: Partial<StopContext> = {}): StopContext => ({
  hunks,
  mechanical: new Set([lockfile.id]),
  parts: [],
  callGraph: [call(client, route, "request"), call(route, keychain)],
  ...overrides,
});

const on = (one: Hunk, startLine: number, line: number, side: "new" | "old" = "new") => ({
  hunkId: one.id,
  side,
  startLine,
  line,
});

const stop = (...excerpts: StopDraft["excerpts"]): StopDraft => ({
  sentence: "A token is saved",
  excerpts,
});

const tour = [
  stop(on(client, 1, 8), on(route, 2, 10)),
  stop(on(keychain, 2, 3)),
  stop(on(keychain, 6, 6)),
];

describe("validateStops", () => {
  it("finds nothing wrong with stops in call order on lines their hunks show", () => {
    expect(validateStops(tour, context())).toEqual([]);
  });

  it("takes an excerpt of removed lines on the base side", () => {
    expect(validateStops([stop(on(keychain, 2, 2, "old"))], context())).toEqual([]);
  });

  it("finds excerpts on an unknown hunk, a proved hunk and lines a hunk doesn't show", () => {
    const stray = { ...on(client, 1, 2), hunkId: "h_0000000000000000" as HunkId };
    expect(
      validateStops(
        [
          stop(stray),
          stop(on(lockfile, 1, 1)),
          stop(on(client, 9, 11)),
          stop(on(keychain, 7, 7, "old")),
        ],
        context(),
      ),
    ).toEqual([
      { kind: "unknown-hunk", stop: 0, excerpt: 0, hunkId: stray.hunkId },
      { kind: "mechanical", stop: 1, excerpt: 0, hunkId: lockfile.id },
      { kind: "lines-outside", stop: 2, excerpt: 0, hunkId: client.id },
      { kind: "lines-outside", stop: 3, excerpt: 0, hunkId: keychain.id },
    ]);
  });

  it("finds a stop with both excerpts in one file", () => {
    expect(validateStops([stop(on(route, 1, 4), on(routeAgain, 53, 53))], context())).toEqual([
      { kind: "same-file", stop: 0 },
    ]);
  });

  it("finds a stop before the stop whose code calls it", () => {
    expect(
      validateStops(
        [stop(on(keychain, 2, 3)), stop(on(route, 1, 4)), stop(on(client, 1, 4))],
        context(),
      ),
    ).toEqual([
      { kind: "order", stop: 0, caller: 1 },
      { kind: "order", stop: 1, caller: 2 },
    ]);
  });

  it("leaves alone stops that call each other, and a type use", () => {
    const both = context({
      callGraph: [call(route, keychain), call(keychain, route), call(client, route, "type")],
    });
    expect(
      validateStops(
        [stop(on(keychain, 2, 3)), stop(on(route, 1, 4)), stop(on(client, 1, 4))],
        both,
      ),
    ).toEqual([]);
  });

  it("follows calls between the parts an excerpt shows, not the whole hunk", () => {
    const read = PartId.parse(`${keychain.id}.1`);
    const write = PartId.parse(`${keychain.id}.2`);
    const split = context({
      parts: [
        { id: read, hunkId: keychain.id, start: 0, end: 4, definitions: ["read"] },
        { id: write, hunkId: keychain.id, start: 4, end: 8, definitions: ["write"] },
      ],
      callGraph: [call(route, write)],
    });
    expect(validateStops([stop(on(keychain, 2, 3)), stop(on(route, 1, 4))], split)).toEqual([]);
    expect(validateStops([stop(on(keychain, 6, 6)), stop(on(route, 1, 4))], split)).toEqual([
      { kind: "order", stop: 0, caller: 1 },
    ]);
  });

  it("finds every stop past the seventh", () => {
    const many = Array.from({ length: 9 }, () => stop(on(client, 1, 4)));
    expect(validateStops(many, context())).toEqual([
      { kind: "too-many", stop: 7 },
      { kind: "too-many", stop: 8 },
    ]);
  });
});

describe("keptStops", () => {
  it("numbers the stops in tour order", () => {
    expect(keptStops(tour, []).map((kept) => kept.id)).toEqual(["t1", "t2", "t3"]);
  });

  it("drops bad excerpts, stops left with none, a second excerpt in one file and stops past seven", () => {
    const many = [
      stop(on(lockfile, 1, 1), on(client, 1, 4)),
      stop(on(client, 9, 11)),
      stop(on(route, 1, 4), on(routeAgain, 53, 53)),
      ...Array.from({ length: 6 }, () => stop(on(keychain, 2, 3))),
    ];
    const kept = keptStops(many, validateStops(many, context()));
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

  it("keeps stops out of order", () => {
    const backwards = [stop(on(keychain, 2, 3)), stop(on(route, 1, 4)), stop(on(client, 1, 4))];
    expect(keptStops(backwards, validateStops(backwards, context()))).toHaveLength(3);
  });
});
