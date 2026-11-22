import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Analysis } from "../../../../src/domain/review/index.ts";
import { fixtureAnalysisView } from "../../../dev/fixtures/index.ts";
import { useMarksHeld } from "./useMarksHeld.ts";

const restore = vi.fn();
const hold = vi.fn((_area: string) => restore);
vi.mock("./heldScroll.ts", () => ({ holdTopLine: (area: string) => hold(area) }));

const base = fixtureAnalysisView.analysis;
const running: Analysis = { ...base, guardrails: "running" };

describe("useMarksHeld", () => {
  beforeEach(() => {
    hold.mockClear();
    restore.mockClear();
  });

  it("notes the top line before a guardrail call's marks go in, and puts it back after", () => {
    const { result, rerender } = renderHook(({ analysis }) => useMarksHeld(analysis), {
      initialProps: { analysis: running },
    });
    const done: Analysis = { ...running, guardrails: "done" };

    rerender({ analysis: done });

    expect(hold).toHaveBeenCalledTimes(1);
    expect(hold).toHaveBeenCalledWith("[aria-label=Changes]");
    expect(restore).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(done);
  });

  it("shows any other change at once, holding nothing", () => {
    const { result, rerender } = renderHook(({ analysis }) => useMarksHeld(analysis), {
      initialProps: { analysis: base },
    });
    const next: Analysis = { ...base, warnings: ["Something"] };

    rerender({ analysis: next });

    expect(result.current).toBe(next);
    expect(hold).not.toHaveBeenCalled();
  });
});
