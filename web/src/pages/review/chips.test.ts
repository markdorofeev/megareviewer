import { describe, expect, it } from "vitest";
import { HunkId, type PartId } from "../../../../src/domain/diff/index.ts";
import {
  type Call,
  type CallMark,
  chipCounts,
  chipPlan,
  requestPlace,
  symbolPlace,
} from "./chips.ts";

const id = (n: number) => HunkId.parse(`h_${n.toString(16).padStart(16, "0")}`);
const [a, b, c, d, e] = [1, 2, 3, 4, 5].map(id) as [PartId, PartId, PartId, PartId, PartId];

type Lines = ReadonlyMap<number, readonly Call[]>;
const callsOf = (
  entries: readonly (readonly [PartId, readonly (readonly [number, string, PartId])[]])[],
): ReadonlyMap<PartId, Lines> =>
  new Map(
    entries.map(([from, calls]) => {
      const lines = new Map<number, Call[]>();
      for (const [line, symbol, toPartId] of calls) {
        lines.set(line, [...(lines.get(line) ?? []), { line, symbol, toPartId }]);
      }
      return [from, lines];
    }),
  );
/** Every line's text names its symbols, so mentions find them. */
const named = (calls: ReadonlyMap<PartId, Lines>) => (from: PartId, line: number) => ({
  text: [
    ...new Set(
      calls
        .get(from)
        ?.get(line)
        ?.map((call) => `${call.symbol}()`),
    ),
  ].join("; "),
  path: "src/app.ts",
});

const kinds = (marks: readonly CallMark[] | undefined) =>
  marks?.map((mark) => `${mark.kind} ${mark.symbol}→${mark.calls.length}`);

describe("chipPlan", () => {
  it("chips the first call to a hunk in a section and mentions the later ones", () => {
    const calls = callsOf([
      [a, [[10, "save", c]]],
      [b, [[20, "save", c]]],
      [d, [[30, "save", c]]],
    ]);
    const plan = chipPlan([[a, b], [d]], calls, named(calls));
    expect(kinds(plan.get(a)?.get(10))).toEqual(["chip save→1"]);
    // A chip says where its symbol is, so the page can make the symbol itself the call.
    expect(plan.get(a)?.get(10)?.[0]).toMatchObject({ at: { start: 0, end: 4 } });
    expect(plan.get(b)?.get(20)).toEqual([
      {
        kind: "mention",
        symbol: "save",
        calls: [{ line: 20, symbol: "save", toPartId: c }],
        at: { start: 0, end: 4 },
      },
    ]);
    // The next section reads on its own, so its first call is a chip again.
    expect(kinds(plan.get(d)?.get(30))).toEqual(["chip save→1"]);
  });

  it("reads a hunk's lines in order, whatever order the calls come in", () => {
    const calls = callsOf([
      [
        a,
        [
          [30, "save", c],
          [10, "save", c],
        ],
      ],
    ]);
    const plan = chipPlan([[a]], calls, named(calls));
    expect(kinds(plan.get(a)?.get(10))).toEqual(["chip save→1"]);
    expect(kinds(plan.get(a)?.get(30))).toEqual(["mention save→1"]);
  });

  it("makes one mark of one symbol reaching several hunks, a chip while any is new", () => {
    const calls = callsOf([
      [
        a,
        [
          [10, "account", c],
          [10, "account", d],
        ],
      ],
      [
        b,
        [
          [20, "account", c],
          [20, "account", e],
        ],
      ],
      [
        e,
        [
          [40, "account", c],
          [40, "account", d],
        ],
      ],
    ]);
    const plan = chipPlan([[a, b, e]], calls, named(calls));
    expect(kinds(plan.get(a)?.get(10))).toEqual(["chip account→2"]);
    expect(kinds(plan.get(b)?.get(20))).toEqual(["chip account→2"]);
    expect(kinds(plan.get(e)?.get(40))).toEqual(["mention account→2"]);
  });

  it("keeps two symbols on one line apart", () => {
    const calls = callsOf([
      [
        a,
        [
          [10, "account", c],
          [10, "withToken", d],
        ],
      ],
    ]);
    expect(
      kinds(
        chipPlan([[a]], calls, named(calls))
          .get(a)
          ?.get(10),
      ),
    ).toEqual(["chip account→1", "chip withToken→1"]);
  });

  it("keeps a chip when the symbol isn't on the line's text", () => {
    const calls = callsOf([
      [
        a,
        [
          [10, "save", c],
          [11, "save", c],
          [12, "save", c],
        ],
      ],
    ]);
    const text = (_: PartId, line: number) =>
      line === 11 ? { text: "  token,", path: "src/app.ts" } : undefined;
    const plan = chipPlan([[a]], calls, text);
    expect(kinds(plan.get(a)?.get(11))).toEqual(["chip save→1"]);
    expect(kinds(plan.get(a)?.get(12))).toEqual(["chip save→1"]);
  });

  it("places a request at its path, so the path in the code is the call", () => {
    const line = '    rows = client.get("/api/account-connections", headers=A)';
    const request: Call = {
      line: 10,
      symbol: "GET /api/account-connections",
      toPartId: c,
      request: true,
    };
    const plan = chipPlan([[a]], new Map([[a, new Map([[10, [request]]])]]), () => ({
      text: line,
      path: "tests/test_api.py",
    }));
    const [mark] = plan.get(a)?.get(10) ?? [];
    expect(mark?.at && line.slice(mark.at.start, mark.at.end)).toBe("/api/account-connections");
  });

  it("matches a request's path to its route by the rules that linked them", () => {
    // The code under test is a template literal, written here as plain text.
    const placeholder = (name: string) => `$\{${name}}`;
    const path = `/hosts/${placeholder("domain")}/token`;
    const line = `await api.put(\`${placeholder("base")}${path}\`, body)`;
    const at = requestPlace(line, "web/src/api.ts", "PUT /hosts/{domain}/token");
    expect(at && line.slice(at.start, at.end)).toBe(path);
    expect(requestPlace(line, "web/src/api.ts", "DELETE /hosts/{domain}/token")).toBeNull();
    expect(requestPlace("rows = load()", "web/src/api.ts", "GET /api/x")).toBeNull();
  });

  it("places a hunk once, at its first section", () => {
    const calls = callsOf([[a, [[10, "save", c]]]]);
    const plan = chipPlan([[b, a], [a]], calls, named(calls));
    expect(kinds(plan.get(a)?.get(10))).toEqual(["chip save→1"]);
  });

  it("counts chips, ambiguous chips and mentions", () => {
    const calls = callsOf([
      [
        a,
        [
          [10, "x", c],
          [10, "x", d],
          [11, "x", c],
        ],
      ],
    ]);
    expect(chipCounts(chipPlan([[a]], calls, named(calls)))).toEqual({
      chips: 1,
      ambiguous: 1,
      mentions: 1,
    });
  });

  it("puts every call in exactly one mark, over random calls", () => {
    // A small seeded generator, so a failure repeats.
    let seed = 26;
    const random = (below: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % below;
    };
    const hunks = [a, b, c, d, e];
    const pick = <T>(items: readonly T[]): T => items[random(items.length)] as T;
    const key = (from: PartId, call: Call) =>
      `${from}@${call.line}:${call.symbol}>${call.toPartId}`;
    for (let run = 0; run < 200; run++) {
      const list = Array.from({ length: random(30) }, () => ({
        from: pick(hunks),
        call: { line: 1 + random(6), symbol: pick(["x", "y", "z"]), toPartId: pick(hunks) },
      }));
      const unique = [...new Map(list.map((one) => [key(one.from, one.call), one])).values()];
      const calls = callsOf(
        hunks.map((from) => [
          from,
          unique.flatMap((one) =>
            one.from === from ? [[one.call.line, one.call.symbol, one.call.toPartId] as const] : [],
          ),
        ]),
      );
      const cut = 1 + random(4);
      const plan = chipPlan([hunks.slice(0, cut), hunks.slice(cut)], calls, named(calls));
      const marked = [...plan].flatMap(([from, lines]) =>
        [...lines.values()].flat().flatMap((mark) => mark.calls.map((one) => key(from, one))),
      );
      expect(marked.sort()).toEqual(unique.map((one) => key(one.from, one.call)).sort());
    }
  });
});

describe("symbolPlace", () => {
  it("finds the symbol as a whole word", () => {
    expect(symbolPlace("x = self.save_token(t)", "save_token")).toEqual({ start: 9, end: 19 });
    expect(symbolPlace("autosave(t); save(t)", "save")).toEqual({ start: 13, end: 17 });
    expect(symbolPlace("$save(t)", "save")).toBeNull();
    expect(symbolPlace("a.b(c)", "a.b")).toEqual({ start: 0, end: 3 });
    expect(symbolPlace("anything", "")).toBeNull();
  });
});
