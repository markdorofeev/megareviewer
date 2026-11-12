import { describe, expect, it } from "vitest";
import type { ReviewThread } from "../../../../src/domain/review/index.ts";
import { fixtureAnalysisView, fixtureThreads } from "../../../dev/fixtures/index.ts";
import { mapFiles, partIndex } from "./model.ts";
import { placeKey, placeThreads } from "./threads.ts";

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
