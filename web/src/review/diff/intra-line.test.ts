import { describe, expect, it } from "vitest";
import {
  type CharRange,
  commonWords,
  intraLineChanges,
  MAX_INTRA_LINE_LENGTH,
  splitWords,
  wordDiff,
} from "./intra-line.ts";

const del = (text: string) => ({ kind: "del" as const, text });
const add = (text: string) => ({ kind: "add" as const, text });
const context = (text: string) => ({ kind: "context" as const, text });

/** The text of each range. */
const pieces = (text: string, ranges: readonly CharRange[] | undefined) =>
  ranges?.map(({ start, end }) => text.slice(start, end));

describe("splitWords", () => {
  it("splits words, whitespace runs and single punctuation", () => {
    expect(splitWords("const total_1 = a.b(  c);")).toEqual([
      "const",
      " ",
      "total_1",
      " ",
      "=",
      " ",
      "a",
      ".",
      "b",
      "(",
      "  ",
      "c",
      ")",
      ";",
    ]);
  });

  it("keeps letters outside ASCII in words", () => {
    expect(splitWords("prix:Größe")).toEqual(["prix", ":", "Größe"]);
  });

  it("returns nothing for an empty line", () => {
    expect(splitWords("")).toEqual([]);
  });
});

describe("commonWords", () => {
  const lcsLength = (a: readonly string[], b: readonly string[]): number => {
    const table = Array.from({ length: a.length + 1 }, () =>
      new Array<number>(b.length + 1).fill(0),
    );
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const row = table[i] ?? [];
        row[j] =
          a[i - 1] === b[j - 1]
            ? (table[i - 1]?.[j - 1] ?? 0) + 1
            : Math.max(table[i - 1]?.[j] ?? 0, row[j - 1] ?? 0);
      }
    }
    return table[a.length]?.[b.length] ?? 0;
  };

  it.each([
    [[], []],
    [["a"], []],
    [[], ["a"]],
    [
      ["a", "b", "c"],
      ["a", "b", "c"],
    ],
    [
      ["a", "b", "c", "a", "b", "b", "a"],
      ["c", "b", "a", "b", "a", "c"],
    ],
    [
      ["x", "y"],
      ["y", "x"],
    ],
    [["a", "a", "a"], ["a"]],
  ])("finds a longest common subsequence of %j and %j", (a, b) => {
    const { inOld, inNew } = commonWords(a, b);
    const fromOld = a.filter((_, i) => inOld[i]);
    const fromNew = b.filter((_, i) => inNew[i]);
    expect(fromOld).toEqual(fromNew);
    expect(fromOld).toHaveLength(lcsLength(a, b));
  });

  it("agrees with dynamic programming on random lists", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const list = () =>
      Array.from({ length: Math.floor(random() * 12) }, () =>
        "abcd".charAt(Math.floor(random() * 4)),
      );
    for (let run = 0; run < 200; run++) {
      const a = list();
      const b = list();
      const { inOld, inNew } = commonWords(a, b);
      const fromOld = a.filter((_, i) => inOld[i]);
      expect(fromOld).toEqual(b.filter((_, i) => inNew[i]));
      expect(fromOld).toHaveLength(lcsLength(a, b));
    }
  });
});

describe("wordDiff", () => {
  it("marks the changed words of each side, merging neighbors into one range", () => {
    const before = "res.json(orders.map(toResponse));";
    const after = "res.json({ items: orders.map(toResponse) });";
    const changed = wordDiff(before, after);
    expect(pieces(before, changed?.old)).toEqual([]);
    expect(pieces(after, changed?.new)).toEqual(["{ items: ", " }"]);
  });

  it("marks a replaced word on both sides", () => {
    const changed = wordDiff("step publish --tag next", "step publish --tag latest");
    expect(pieces("step publish --tag next", changed?.old)).toEqual(["next"]);
    expect(pieces("step publish --tag latest", changed?.new)).toEqual(["latest"]);
  });

  it("returns empty ranges for identical lines", () => {
    expect(wordDiff("same", "same")).toEqual({ old: [], new: [] });
    expect(wordDiff("", "")).toEqual({ old: [], new: [] });
  });

  it(`skips lines over ${MAX_INTRA_LINE_LENGTH} characters`, () => {
    const long = "a ".repeat(MAX_INTRA_LINE_LENGTH / 2);
    expect(wordDiff(long, `${long}b`)).toBeNull();
    expect(wordDiff(`${long}b`, long)).toBeNull();
    expect(wordDiff(long.slice(1), `${long.slice(1)}b`)).not.toBeNull();
  });

  it("skips pairs with less than 30% in common", () => {
    // "abcdef" on both sides: 12 of 40 characters, 30%, kept.
    expect(wordDiff("abcdef(ghijklmnopqrs", "abcdef[tuvwxyzABCDEF")).not.toBeNull();
    // 12 of 42 characters, 29%: a rewrite.
    expect(wordDiff("abcdef(ghijklmnopqrsT", "abcdef[tuvwxyzABCDEFG")).toBeNull();
    expect(wordDiff("return total;", "throw new Error(message)")).toBeNull();
  });
});

describe("intraLineChanges", () => {
  it("pairs a run of deleted lines with the added run right after it, line by line", () => {
    const lines = [
      context("{"),
      del("  a: 1,"),
      del("  b: 2,"),
      add("  a: 10,"),
      add("  b: 20,"),
      add("  c: 30,"),
      context("}"),
    ];
    const changes = intraLineChanges(lines);
    expect([...changes.keys()]).toEqual([1, 3, 2, 4]);
    expect(pieces("  a: 1,", changes.get(1))).toEqual(["1"]);
    expect(pieces("  a: 10,", changes.get(3))).toEqual(["10"]);
    expect(pieces("  b: 20,", changes.get(4))).toEqual(["20"]);
    expect(changes.has(5)).toBe(false);
  });

  it("doesn't pair deleted lines with added lines after a context line", () => {
    expect(intraLineChanges([del("a = 1"), context("b"), add("a = 2")]).size).toBe(0);
  });

  it("doesn't pair added lines that come before deleted ones", () => {
    expect(intraLineChanges([add("a = 1"), del("a = 2")]).size).toBe(0);
  });

  it("leaves out pairs that are rewrites", () => {
    const changes = intraLineChanges([
      del("return total;"),
      del("x = 1"),
      add("throw new Error(message)"),
      add("x = 2"),
    ]);
    expect([...changes.keys()]).toEqual([1, 3]);
  });
});
