import { describe, expect, it } from "vitest";
import {
  type Analysis,
  type HunkComment,
  type Point,
  PointId,
  type PointState,
  type ReviewThread,
} from "../../../../src/domain/review/index.ts";
import {
  fixtureAnalysisView,
  fixtureHunks,
  fixtureParts,
  fixtureThreads,
} from "../../../dev/fixtures/index.ts";
import type { LinePlace } from "../../review/index.ts";
import {
  byTreePath,
  changeTotals,
  commentedPoints,
  gapBetween,
  mapFiles,
  openedOn,
  parseLayout,
  partIndex,
  pointPlaces,
  trailingProofs,
} from "./model.ts";
import { formatCost, formatTokens, formatTotalCost } from "./UsageFooter.tsx";

const analysis = fixtureAnalysisView.analysis;
const h = fixtureHunks;
const p = fixtureParts;

describe("partIndex", () => {
  it("pairs each hunk with its file and risk, in the order asked", () => {
    const items = partIndex(analysis).items([p.cache, h.dependency]);
    expect(items.map((item) => [item.file.path, item.risk.riskClass])).toEqual([
      ["src/services/receipts.ts", "logic"],
      ["package.json", "contract"],
    ]);
  });

  it("reads a hunk without an assessment as logic, never mechanical", () => {
    const early: Analysis = { ...analysis, risk: [] };
    const [item] = partIndex(early).items([h.receiptRoute]);
    expect(item?.risk).toEqual({
      hunkId: h.receiptRoute,
      riskClass: "logic",
      reason: "Not classified yet.",
      source: "rule",
    });
  });

  it("skips IDs it doesn't know", () => {
    expect(partIndex({ ...analysis, files: [] }).items([h.dependency])).toEqual([]);
  });
});

describe("mapFiles", () => {
  const index = partIndex(analysis);

  it("lists the files with a part to review in path order, each with all its parts in order", () => {
    const files = mapFiles(analysis, index);
    const paths = files.map((group) => group.file.path);
    expect(paths).toEqual([...paths].sort(byTreePath));
    const receipts = files.find((group) => group.file.path === "src/services/receipts.ts");
    if (receipts === undefined) throw new Error("no receipts.ts");
    expect(receipts.partIds).toEqual(index.partsInFile(receipts.file));
    // A mechanical part stays in place on its file's card.
    const orders = files.find((group) => group.file.path === "src/routes/orders.ts");
    expect(orders?.partIds).toContain(h.formatMoneyRemoved);
  });

  it("leaves out files with nothing but mechanical changes", () => {
    const files = mapFiles(analysis, index);
    expect(files.every((group) => group.partIds.some((id) => !index.mechanical.has(id)))).toBe(
      true,
    );
  });
});

describe("byTreePath", () => {
  it("lists directories before files at each level, then by name", () => {
    const paths = ["b.ts", "src/z.ts", "README.md", "src/a/b.ts", "a/x.ts", "src/B.ts", "src/a.ts"];
    expect([...paths].sort(byTreePath)).toEqual([
      "a/x.ts",
      "src/a/b.ts",
      "src/a.ts",
      "src/B.ts",
      "src/z.ts",
      "b.ts",
      "README.md",
    ]);
  });
});

describe("gapBetween", () => {
  const index = partIndex(analysis);

  it("counts the unchanged lines between two parts of a file", () => {
    // The imports are lines 1–8 and the route starts at line 10.
    expect(gapBetween(h.routeImports, h.receiptRoute, index)).toBe(1);
    expect(gapBetween(h.routeImports, p.cache, index)).toBeNull();
  });
});

describe("a split part's risk", () => {
  it("is its hunk's", () => {
    const assessed: Analysis = {
      ...analysis,
      risk: analysis.risk.map((risk) =>
        risk.hunkId === h.retryAndCache
          ? { ...risk, riskClass: "contract" as const, reason: "Whole hunk." }
          : risk,
      ),
    };
    expect(partIndex(assessed).items([p.cache])[0]?.risk).toMatchObject({
      riskClass: "contract",
      reason: "Whole hunk.",
    });
  });
});

describe("commentedPoints", () => {
  const f1: Point = {
    id: PointId.parse("f1"),
    title: "Any signed-in user can read every customer's receipt",
    explanation: "",
    path: "src/routes/orders.ts",
    lines: { hunkId: h.receiptRoute, side: "new", startLine: 15, line: 15 },
    hunkIds: [h.receiptRoute],
    type: "logic",
    severity: "blocking",
    suggestion: null,
    mismatch: null,
  };
  const [first] = fixtureThreads.threads;
  if (first === undefined) throw new Error("no fixture thread");
  const thread = (changes: Partial<ReviewThread> = {}, authorId = "lee-park"): ReviewThread => ({
    ...first,
    path: "src/routes/orders.ts",
    line: 15,
    comments: [
      {
        ...first.comments[0],
        id: "c1",
        author: { id: authorId, name: "Lee" },
        body: "x",
        createdAt: "2026-10-22T10:00:00Z",
        originalCommit: null,
      },
    ],
    ...changes,
  });
  const raised = (): PointState => "raised";
  const commented = (
    threads: readonly ReviewThread[],
    {
      state = raised,
      drafts = [] as readonly HunkComment[],
      reviewer = "lee-park" as string | null,
    } = {},
  ) => [...commentedPoints([f1], state, drafts, threads, reviewer)];

  it("holds a raised point whose line has the reviewer's thread and no draft", () => {
    expect(commented([thread()])).toEqual([f1.id]);
  });

  it("leaves a point the reviewer didn't raise, or whose draft is still waiting", () => {
    expect(commented([thread()], { state: () => "open" })).toEqual([]);
    const draft: HunkComment = { hunkId: h.receiptRoute, side: "new", line: 15, body: "x" };
    expect(commented([thread()], { drafts: [draft] })).toEqual([]);
  });

  it("leaves it for a thread on another line, side or file, an outdated one or someone else's", () => {
    expect(commented([thread({ line: 14 })])).toEqual([]);
    expect(commented([thread({ side: "old" })])).toEqual([]);
    expect(commented([thread({ path: "src/app.ts" })])).toEqual([]);
    expect(commented([thread({ outdated: true })])).toEqual([]);
    expect(commented([thread({}, "sam-rivera")])).toEqual([]);
  });

  it("takes anyone's thread when the reviewer is unknown", () => {
    expect(commented([thread({}, "sam-rivera")], { reviewer: null })).toEqual([f1.id]);
  });
});

describe("pointPlaces", () => {
  const index = partIndex(analysis);
  const order = mapFiles(analysis, index).flatMap((group) => group.partIds);
  const point = (id: string, hunkIds: readonly (typeof h)[keyof typeof h][]): Point => ({
    id: PointId.parse(id),
    title: id,
    explanation: "w",
    path: null,
    lines: null,
    hunkIds,
    type: null,
    severity: null,
    suggestion: null,
    mismatch: null,
  });

  it("puts each card on the point's first hunk in the page's order, and links the others", () => {
    const m5 = point("m5", [h.dependency, h.receiptFormatting]);
    const places = pointPlaces([m5], order, index);
    expect(places.cards.get(h.receiptFormatting)).toEqual([m5]);
    expect(places.mentions.get(h.dependency)).toEqual([m5]);
    expect(places.cardPart.get(m5.id)).toBe(h.receiptFormatting);
    expect(places.unplaced).toEqual([]);
  });

  it("puts a card on the part showing its lines, whatever the page's order", () => {
    const cachePart = index.parts.get(p.cache);
    const line = cachePart?.hunk.lines.find((one) => one.kind === "add")?.newLine;
    if (line == null) throw new Error("the cache part has an added line");
    const onCache: Point = {
      ...point("f1", [h.retryAndCache]),
      lines: { hunkId: h.retryAndCache, side: "new", startLine: line, line },
    };
    const places = pointPlaces([onCache], order, index);
    expect(places.cards.get(p.cache)).toEqual([onCache]);
    // The retry part is the same hunk's, around the card: no link back.
    expect(places.mentions.get(p.retry)).toBeUndefined();
  });

  it("never puts a card on a mechanical hunk, and keeps points on none apart", () => {
    const moved = point("m1", [h.formatMoneyRemoved, h.retryAndCache]);
    const nowhere = point("m2", [h.formatMoneyAdded]);
    const places = pointPlaces([moved, nowhere], order, index);
    // The card goes on the split hunk's first part on the page, and its other part links to it.
    expect(places.cards.get(p.retry)).toEqual([moved]);
    expect(places.mentions.get(p.cache)).toEqual([moved]);
    expect(places.mentions.get(h.formatMoneyRemoved)).toBeUndefined();
    expect(places.unplaced).toEqual([nowhere]);
  });
});

describe("parseLayout", () => {
  it("reads a stored call tree as the overview that replaced it", () => {
    expect(parseLayout("tree")).toBe("overview");
    expect(parseLayout("overview")).toBe("overview");
    expect(parseLayout("map")).toBe("map");
    expect(parseLayout("tour")).toBe("tour");
    expect(parseLayout("graph")).toBeUndefined();
  });
});

describe("usage formatting", () => {
  it("rounds token counts and shows dollars to the cent", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(182_400)).toBe("182k");
    expect(formatTokens(2_350_000)).toBe("2.4M");
    expect(formatCost(0.9349)).toBe("$0.93");
  });

  it("calls a plan's cost an estimate at API prices", () => {
    expect(formatTotalCost([0.9, 0.0349], false)).toBe("$0.93");
    expect(formatTotalCost([0.9349], true)).toBe("≈ $0.93 at API prices, on your Claude plan");
    expect(formatTotalCost([0.9349], true, "ChatGPT")).toBe(
      "≈ $0.93 at API prices, on your ChatGPT plan",
    );
  });

  it("says how many calls have no known price instead of summing around them", () => {
    expect(formatTotalCost([0.5, null, null], true, "ChatGPT")).toBe(
      "≈ $0.50 at API prices, cost unknown for 2 calls, on your ChatGPT plan",
    );
    expect(formatTotalCost([0.5, null], false)).toBe("$0.50, cost unknown for 1 call");
    expect(formatTotalCost([null, null], true, "ChatGPT")).toBe("on your ChatGPT plan");
    expect(formatTotalCost([null], false)).toBe("cost unknown");
  });
});

describe("trailingProofs", () => {
  const index = partIndex(analysis);

  it("leaves mechanical hunks of files with other changes out of the mechanical group", () => {
    const trailing = trailingProofs(analysis, index);
    expect(trailing.some((proof) => proof.hunkId === h.formatMoneyRemoved)).toBe(false);
    expect(trailing).toHaveLength(analysis.proofs.length - 1);
  });
});

describe("totals", () => {
  it("count every file the PR changes, mechanical ones too, and the lines", () => {
    const totals = changeTotals(analysis.files);
    expect(totals).toEqual({ files: 7, additions: 58, deletions: 13 });
    expect(changeTotals([])).toEqual({ files: 0, additions: 0, deletions: 0 });
  });
});

describe("openedOn", () => {
  const hunkId = h.routeImports;
  const range = { side: "new" as const, startLine: 10, line: 12 };
  const draft = { hunkId, side: "new" as const, line: 11, body: "Why?" };

  it("takes the open box's draft along to the range's last line, when the range covers it", () => {
    expect(openedOn([draft], hunkId, range, { side: "new", line: 11 })).toEqual({
      place: range,
      comments: [{ ...draft, line: 12, startLine: 10 }],
    });
    const last = { ...draft, line: 12 };
    expect(openedOn([last], hunkId, range, { side: "new", line: 12 }).comments).toEqual([
      { ...last, startLine: 10 },
    ]);
  });

  it("leaves a draft the range doesn't cover, or on the other side or hunk, where it is", () => {
    const stays = (drafts: readonly HunkComment[], open: LinePlace | null) =>
      expect(openedOn(drafts, hunkId, range, open)).toEqual({ place: range, comments: drafts });
    stays([{ ...draft, line: 14 }], { side: "new", line: 14 });
    stays([{ ...draft, startLine: 8 }], { side: "new", startLine: 8, line: 11 });
    stays([{ ...draft, side: "old" }], { side: "old", line: 11 });
    stays([{ ...draft, hunkId: h.dependency }], { side: "new", line: 11 });
    stays([draft], null);
  });

  it("opens the draft a line already has, on its own lines, and puts no second one on it", () => {
    const last = { ...draft, startLine: 8, line: 12, body: "And this?" };
    const own = { side: "new", line: 12, startLine: 8 };
    for (const open of [null, { side: "new" as const, line: 11 }]) {
      expect(openedOn([draft, last], hunkId, range, open)).toEqual({
        place: own,
        comments: [draft, last],
      });
    }
    // From the line's number, and from a selection within the open box's own last line.
    const line = { side: "new" as const, line: 12 };
    expect(openedOn([last], hunkId, line, null).place).toEqual(own);
    expect(openedOn([last], hunkId, line, { ...line, startLine: 8 }).place).toEqual(own);
  });
});
