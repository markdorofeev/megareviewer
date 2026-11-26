import { describe, expect, it } from "vitest";
import { type CallGraphHint, type CallSite, HunkId, type HunkPart, PartId } from "../diff/index.ts";
import { type Flow, joinParts } from "./index.ts";

const a = HunkId.parse("h_000000000000000a");
const b = HunkId.parse("h_000000000000000b");
const p = (hunk: HunkId, n: number): PartId => PartId.parse(`${hunk}.${n}`);

/** Hunk a cut into four candidates of two lines each, named f1 to f4. */
const candidates: HunkPart[] = [1, 2, 3, 4].map((n) => ({
  id: p(a, n),
  hunkId: a,
  start: (n - 1) * 2,
  end: n * 2,
  definitions: [`f${n}`],
}));

const flows = (...parts: PartId[][]): Flow[] =>
  parts.map((partIds, at) => ({ title: `Flow ${at + 1}`, partIds, kind: "flow", entries: [] }));

const call = (from: PartId, to: PartId, line: number): CallGraphHint => ({
  fromPartId: from,
  toPartId: to,
  symbol: "f",
  line,
  use: "call",
});

describe("joinParts", () => {
  it("joins consecutive candidates in one flow into one part, numbered again", () => {
    const joined = joinParts(flows([p(a, 1), p(a, 2), b], [p(a, 3)], [p(a, 4)]), candidates, []);
    expect(joined.parts).toEqual([
      { id: p(a, 1), hunkId: a, start: 0, end: 4, definitions: ["f1", "f2"] },
      { id: p(a, 2), hunkId: a, start: 4, end: 6, definitions: ["f3"] },
      { id: p(a, 3), hunkId: a, start: 6, end: 8, definitions: ["f4"] },
    ]);
    expect(joined.flows.map((flow) => flow.partIds)).toEqual([[p(a, 1), b], [p(a, 2)], [p(a, 3)]]);
  });

  it("gives back the hunk ID when every candidate landed in one flow", () => {
    const joined = joinParts(flows([b, p(a, 1), p(a, 2), p(a, 3), p(a, 4)]), candidates, [
      call(b, p(a, 3), 5),
      call(p(a, 1), p(a, 4), 2),
    ]);
    expect(joined.parts).toEqual([]);
    expect(joined.flows[0]?.partIds).toEqual([b, a]);
    // A call between two candidates is now within the hunk, so it's gone.
    expect(joined.callGraph).toEqual([call(b, a, 5)]);
  });

  it("doesn't join candidates of one flow that another flow's candidate separates", () => {
    const joined = joinParts(flows([p(a, 1), p(a, 3)], [p(a, 2), p(a, 4)]), candidates, []);
    expect(joined.parts.map((part) => part.definitions)).toEqual([["f1"], ["f2"], ["f3"], ["f4"]]);
  });

  it("renames entries and hints to the joined parts", () => {
    const [first, second] = flows([p(a, 1), p(a, 2)], [p(a, 3), p(a, 4), b]);
    if (first === undefined || second === undefined) throw new Error("two flows expected");
    const withEntries: Flow[] = [{ ...first, entries: [p(a, 1), p(a, 2)] }, second];
    const joined = joinParts(withEntries, candidates, [
      call(b, p(a, 2), 9),
      call(b, p(a, 1), 7),
      call(p(a, 4), p(a, 1), 3),
    ]);
    expect(joined.flows.map((flow) => flow.entries)).toEqual([[p(a, 1)], []]);
    expect(joined.callGraph).toEqual([call(b, p(a, 1), 7), call(p(a, 2), p(a, 1), 3)]);
  });

  it("renames call sites, dropping parts joined into the site's own", () => {
    const site = (from: PartId, ...to: PartId[]): CallSite => ({
      partId: from,
      path: "app.py",
      line: 3,
      column: 4,
      length: 1,
      symbol: "f",
      toPartIds: to,
    });
    const joined = joinParts(
      flows([p(a, 1), p(a, 2)], [p(a, 3), p(a, 4)]),
      candidates,
      [],
      [],
      [site(b, p(a, 2), p(a, 1), p(a, 4)), site(p(a, 1), p(a, 2)), site(p(a, 1), p(a, 2), p(a, 3))],
    );
    expect(joined.callSites).toEqual([site(b, p(a, 1), p(a, 2)), site(p(a, 1), p(a, 2))]);
  });

  it("renames the parts definitions are in, keeping their calls within a joined part", () => {
    const joined = joinParts(
      flows([p(a, 1), p(a, 2)], [p(a, 3), p(a, 4)]),
      candidates,
      [],
      [],
      [],
      [
        { name: "f1", partIds: [p(a, 1), p(a, 2)], calls: [1], requests: [] },
        {
          name: "f2",
          partIds: [p(a, 2)],
          calls: [],
          requests: [{ symbol: "POST /orders", toPartId: p(a, 4) }],
        },
      ],
    );
    expect(joined.definitionCalls).toEqual([
      { name: "f1", partIds: [p(a, 1)], calls: [1], requests: [] },
      {
        name: "f2",
        partIds: [p(a, 1)],
        calls: [],
        requests: [{ symbol: "POST /orders", toPartId: p(a, 2) }],
      },
    ]);
  });
});
