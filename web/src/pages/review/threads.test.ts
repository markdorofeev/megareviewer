import { describe, expect, it } from "vitest";
import type { ReviewThread } from "../../../../src/domain/review/index.ts";
import { fixtureAnalysisView, fixtureThreads } from "../../../dev/fixtures/index.ts";
import { mapFiles, partIndex } from "./model.ts";
import {
  applyLabel,
  type BatchEntry,
  batchFiles,
  batchProblem,
  placeKey,
  placeThreads,
  suggestionsIn,
} from "./threads.ts";

const { analysis } = fixtureAnalysisView;
const index = partIndex(analysis);
const files = mapFiles(analysis, index);
const [tax, attempts, money, earlier] = fixtureThreads.threads;

describe("placeThreads", () => {
  it("places every thread once: on a line, under Earlier comments, or with files without a card", () => {
    const placement = placeThreads(fixtureThreads.threads, files, index);
    const onLine = [...placement.onLine.values()].flatMap((lines) => [...lines.values()].flat());
    const earlierOnes = [...placement.earlier.values()].flat();
    expect(onLine.map((thread) => thread.id).sort()).toEqual([attempts?.id, tax?.id].sort());
    expect(earlierOnes).toEqual([earlier]);
    expect(placement.elsewhere).toEqual([money]);
    expect(placement.open.get("src/services/receipts.ts")).toBe(2);
    // Resolved threads aren't counted.
    expect(placement.open.get("src/lib/money.ts")).toBeUndefined();
  });

  it("sends a thread on a line no part shows to Earlier comments", () => {
    const unshown: ReviewThread = { ...(tax as ReviewThread), id: "PRRT_x", line: 900 };
    const placement = placeThreads([unshown], files, index);
    expect(placement.earlier.get("src/services/receipts.ts")).toEqual([unshown]);
  });

  it("places nothing without threads", () => {
    expect(placeThreads(null, files, index).onLine.size).toBe(0);
    expect(placeKey({ side: "old", line: 3 })).toBe("old:3");
  });
});

describe("the batch", () => {
  const entries = suggestionsIn(fixtureThreads.threads);
  const entry = (start: number, end: number, commentId = "x"): BatchEntry => ({
    commentId,
    path: "a.ts",
    start,
    end,
    lines: [],
  });

  it("finds the suggestions that can still be applied", () => {
    expect([...entries.keys()]).toEqual(["PRRC_attempts1"]);
    expect(entries.get("PRRC_attempts1")).toMatchObject({ start: 29, end: 29 });
  });

  it("refuses a suggestion that overlaps one already in the batch", () => {
    expect(batchProblem(entry(3, 5, "b"), [entry(5, 6, "a")])).toBe(
      "Changes lines 5–6 too, like a suggestion already in the batch.",
    );
    expect(batchProblem(entry(3, 4, "b"), [entry(5, 5, "a")])).toBeNull();
    expect(batchProblem(entry(5, 5, "a"), [entry(5, 5, "a")])).toBeNull();
    expect(batchProblem(entry(5, 5, "b"), [entry(5, 5, "a")])).toContain("line 5 too");
    expect(batchProblem(undefined, [])).not.toBeNull();
  });

  it("groups the batch by file for the preview", () => {
    const other = { ...entry(1, 1, "c"), path: "b.ts" };
    expect(
      batchFiles([entry(1, 1, "a"), other, entry(4, 4, "b")]).map((file) => file.path),
    ).toEqual(["a.ts", "b.ts"]);
    expect(applyLabel(1)).toBe("Apply 1 suggestion");
    expect(applyLabel(3)).toBe("Apply 3 suggestions");
  });
});
