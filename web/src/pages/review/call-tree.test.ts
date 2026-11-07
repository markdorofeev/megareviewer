import { describe, expect, it } from "vitest";
import { type CallGraphHint, HunkId } from "../../../../src/domain/diff/index.ts";
import { callTree, treeOrder } from "./call-tree.ts";

const id = (n: number): HunkId => HunkId.parse(`h_${n.toString(16).padStart(16, "0")}`);
const [a, b, c, d, e] = [1, 2, 3, 4, 5].map(id) as [HunkId, HunkId, HunkId, HunkId, HunkId];

const call = (from: HunkId, to: HunkId, symbol: string, line = 1): CallGraphHint => ({
  fromHunkId: from,
  toHunkId: to,
  symbol,
  line,
  use: "call",
});

const pathOf = (hunkId: HunkId) => (hunkId === d || hunkId === e ? "src/other.ts" : "src/a.ts");

/** Rows as `depth kind symbol hunk`, for readable expectations. */
const rows = (tree: ReturnType<typeof callTree>) =>
  tree.rows.map(
    (row) =>
      `${row.depth} ${row.kind === "reference" ? "ref " : ""}${row.symbol ?? "root"} ${row.hunkId}`,
  );

describe("callTree", () => {
  it("walks a chain from its entry point", () => {
    const tree = callTree([c, b, a], [call(a, b, "load"), call(b, c, "fetch")], pathOf);
    expect(rows(tree)).toEqual([`0 root ${a}`, `1 load ${b}`, `2 fetch ${c}`]);
    expect(tree.rows[2]).toMatchObject({ parent: b });
    expect(tree.offPath).toEqual([]);
  });

  it("places a hunk two callers share once, and the second caller refers to it", () => {
    const tree = callTree(
      [a, b, c, d],
      [call(a, b, "left", 1), call(a, c, "right", 2), call(b, d, "shared"), call(c, d, "shared")],
      pathOf,
    );
    expect(rows(tree)).toEqual([
      `0 root ${a}`,
      `1 left ${b}`,
      `2 shared ${d}`,
      `1 right ${c}`,
      `2 ref shared ${d}`,
    ]);
  });

  it("orders children by the line of their call, then by name", () => {
    const tree = callTree(
      [a, b, c, d],
      [call(a, b, "zed", 5), call(a, d, "beta", 2), call(a, c, "alpha", 2)],
      pathOf,
    );
    expect(rows(tree).slice(1)).toEqual([`1 alpha ${c}`, `1 beta ${d}`, `1 zed ${b}`]);
  });

  it("names a child by its first call when a hunk calls it more than once", () => {
    const tree = callTree([a, b], [call(a, b, "later", 9), call(a, b, "first", 3)], pathOf);
    expect(rows(tree)).toEqual([`0 root ${a}`, `1 first ${b}`]);
  });

  it("roots a cycle with no entry point at its first hunk in the order given", () => {
    const tree = callTree([c, b, a], [call(a, b, "x"), call(b, c, "y"), call(c, a, "z")], pathOf);
    expect(rows(tree)).toEqual([`0 root ${c}`, `1 z ${a}`, `2 x ${b}`, `3 ref y ${c}`]);
  });

  it("puts hunks no hint links under their files, and ignores hints to other hunks", () => {
    const outside = id(99);
    const tree = callTree(
      [a, d, b, e],
      [call(a, b, "x"), call(e, outside, "gone"), call(d, d, "self")],
      pathOf,
    );
    expect(rows(tree)).toEqual([`0 root ${a}`, `1 x ${b}`]);
    expect(tree.offPath).toEqual([{ path: "src/other.ts", hunkIds: [d, e] }]);
    expect(treeOrder(tree)).toEqual([a, b, d, e]);
  });

  it("has every hunk exactly once, whatever the hints", () => {
    // A small seeded generator, so a failure repeats.
    let seed = 42;
    const random = (below: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % below;
    };
    for (let run = 0; run < 300; run++) {
      const ids = Array.from({ length: 1 + random(12) }, (_, at) => id(at + 1));
      const hints = Array.from({ length: random(20) }, () => {
        const from = ids[random(ids.length)] ?? a;
        const to = random(5) === 0 ? id(500) : (ids[random(ids.length)] ?? a);
        return call(from, to, `s${random(4)}`, 1 + random(30));
      });
      const tree = callTree(ids, hints, (hunkId) => `f${Number.parseInt(hunkId.slice(2), 16) % 3}`);
      const placed = treeOrder(tree);
      expect([...placed].sort()).toEqual([...ids].sort());
      expect(new Set(placed).size).toBe(placed.length);
      for (const row of tree.rows) {
        if (row.kind === "reference") expect(placed.indexOf(row.hunkId)).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
