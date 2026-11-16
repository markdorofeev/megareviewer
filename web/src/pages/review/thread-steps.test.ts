import { describe, expect, it } from "vitest";
import type { ReviewThread } from "../../../../src/domain/review/index.ts";
import { fixtureAnalysisView, fixtureThreads } from "../../../dev/fixtures/index.ts";
import { mapFiles, partIndex } from "./model.ts";
import { stepThreads, threadOrder, threadScopeOf, threadSteps } from "./thread-steps.ts";
import { placeThreads } from "./threads.ts";

const { analysis } = fixtureAnalysisView;
const index = partIndex(analysis);
const files = mapFiles(analysis, index);
const ids = (threads: readonly ReviewThread[]) => threads.map((thread) => thread.id);
const thread = (id: string, resolved = false): ReviewThread => ({
  ...(fixtureThreads.threads[0] as ReviewThread),
  id,
  resolved,
});
const NONE: ReadonlySet<string> = new Set();

describe("threadOrder", () => {
  it("lists the threads top to bottom: by line in each card, its earlier comments, then the rest", () => {
    const unshown = { ...thread("PRRT_unshown"), line: 900 };
    const placement = placeThreads([unshown, ...fixtureThreads.threads], files, index);
    // Files in path order; attempts is on line 29 and tax on 32, though the host lists tax first.
    expect(ids(threadOrder(placement, files, index))).toEqual([
      "PRRT_earlier",
      "PRRT_attempts",
      "PRRT_tax",
      "PRRT_unshown",
      "PRRT_money",
    ]);
  });

  it("is empty without threads", () => {
    expect(threadOrder(placeThreads(null, files, index), files, index)).toEqual([]);
  });
});

describe("threadSteps", () => {
  const ordered = [thread("a"), thread("b", true), thread("c")];

  it("walks the unresolved threads, or every one", () => {
    expect(ids(threadSteps(ordered, "unresolved", NONE))).toEqual(["a", "c"]);
    expect(ids(threadSteps(ordered, "all", NONE))).toEqual(["a", "b", "c"]);
  });

  it("keeps a thread resolved on this page as a step", () => {
    const resolvedHere = new Set(["c"]);
    const now = [thread("a"), thread("b", true), thread("c", true)];
    expect(ids(threadSteps(now, "unresolved", resolvedHere))).toEqual(["a", "c"]);
  });
});

describe("threadScopeOf", () => {
  it("is the reviewer's choice when they made one", () => {
    expect(threadScopeOf("all", [thread("a")], NONE)).toBe("all");
    expect(threadScopeOf("unresolved", [thread("a", true)], NONE)).toBe("unresolved");
  });

  it("is the unresolved threads, or every one when all are resolved", () => {
    expect(threadScopeOf(null, [thread("a"), thread("b", true)], NONE)).toBe("unresolved");
    expect(threadScopeOf(null, [thread("a", true)], NONE)).toBe("all");
    // The last one resolved here doesn't widen the steps under the reviewer.
    expect(threadScopeOf(null, [thread("a", true)], new Set(["a"]))).toBe("unresolved");
  });
});

describe("stepThreads", () => {
  const ordered = [thread("a"), thread("b", true), thread("c"), thread("d", true)];
  const steps = threadSteps(ordered, "unresolved", NONE);

  it("goes round the steps, both ways", () => {
    expect(stepThreads(ordered, steps, "a", 1)).toBe("c");
    expect(stepThreads(ordered, steps, "c", 1)).toBe("a");
    expect(stepThreads(ordered, steps, "a", -1)).toBe("c");
  });

  it("starts at the first or the last", () => {
    expect(stepThreads(ordered, steps, null, 1)).toBe("a");
    expect(stepThreads(ordered, steps, null, -1)).toBe("c");
    expect(stepThreads(ordered, steps, "gone", 1)).toBe("a");
  });

  it("goes on from a thread outside the steps by its place on the page", () => {
    expect(stepThreads(ordered, steps, "b", 1)).toBe("c");
    expect(stepThreads(ordered, steps, "b", -1)).toBe("a");
    expect(stepThreads(ordered, steps, "d", 1)).toBe("a");
    expect(stepThreads(ordered, steps, "d", -1)).toBe("c");
  });

  it("stays on the one thread there is, and goes nowhere without any", () => {
    const one = [thread("a")];
    expect(stepThreads(one, one, "a", 1)).toBe("a");
    expect(stepThreads(one, one, "a", -1)).toBe("a");
    expect(stepThreads(ordered, [], "a", 1)).toBeNull();
  });
});
