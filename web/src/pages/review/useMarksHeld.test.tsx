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

  it.each(["read", "download-failed"] as const)(
    "holds it when a download ends with the checkout %s",
    (checkout) => {
      const downloading: Analysis = { ...base, checkout: "downloading", unchangedCallers: [] };
      const { result, rerender } = renderHook(({ analysis }) => useMarksHeld(analysis), {
        initialProps: { analysis: downloading },
      });
      const done: Analysis = { ...downloading, checkout };

      rerender({ analysis: done });

      expect(hold).toHaveBeenCalledTimes(1);
      expect(restore).toHaveBeenCalledTimes(1);
      expect(result.current).toBe(done);
    },
  );

  it("leaves it to the landing when a run ends with the download", () => {
    const downloading: Analysis = {
      ...base,
      checkout: "downloading",
      stages: { ...base.stages, findings: "skipped" },
    };
    const { result, rerender } = renderHook(({ analysis }) => useMarksHeld(analysis), {
      initialProps: { analysis: downloading },
    });
    const done: Analysis = {
      ...downloading,
      checkout: "read",
      stages: { ...base.stages, findings: "done" },
    };

    rerender({ analysis: done });

    expect(result.current).toBe(done);
    expect(hold).not.toHaveBeenCalled();
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
