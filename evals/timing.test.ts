import { describe, expect, it } from "vitest";
import type { ModelCall, ModelPass } from "../src/domain/review/index.ts";
import { showTiming, timingOf } from "./timing.ts";

const call = (pass: ModelPass, startedAt: string, durationMs: number, attempt = 1): ModelCall => ({
  pass,
  attempt,
  startedAt,
  durationMs,
  outcome: "ok",
  problems: [],
  error: null,
});

const createdAt = "2026-11-14T10:01:28.000Z";

describe("timingOf", () => {
  it("measures prep up to the first call and adds up each pass's calls in the order they started", () => {
    const timing = timingOf(
      {
        createdAt,
        modelCalls: [
          call("findings", "2026-11-14T10:01:43.000Z", 100_000),
          call("intent", "2026-11-14T10:01:28.400Z", 14_600),
          call("risk", "2026-11-14T10:01:43.000Z", 30_000),
          call("findings", "2026-11-14T10:03:23.000Z", 47_500, 2),
        ],
      },
      174,
      18,
    );
    expect(timing.prepS).toBeCloseTo(0.4);
    expect(timing.passes).toEqual([
      { pass: "intent", seconds: 14.6, calls: 1 },
      { pass: "findings", seconds: 147.5, calls: 2 },
      { pass: "risk", seconds: 30, calls: 1 },
    ]);
    expect(timing.judgeS).toBe(18);
  });

  it("has no prep without a model call", () => {
    expect(timingOf({ createdAt, modelCalls: [] }, 2, null).prepS).toBeNull();
  });
});

describe("showTiming", () => {
  it("names each pass, a retry's calls and the judge", () => {
    expect(
      showTiming({
        analysisS: 173.8,
        prepS: 0.4,
        passes: [
          { pass: "intent", seconds: 14.5, calls: 1 },
          { pass: "findings", seconds: 147.5, calls: 2 },
        ],
        judgeS: 17.6,
      }),
    ).toBe("analysis 174 s (prep 0.4 s · intent 15 s · findings 148 s in 2 calls) · judge 18 s");
  });

  it("leaves out what didn't run", () => {
    expect(showTiming({ analysisS: 3.2, prepS: null, passes: [], judgeS: null })).toBe(
      "analysis 3.2 s",
    );
  });
});
