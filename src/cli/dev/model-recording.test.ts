import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FindingDraft } from "../../application/ports/index.ts";
import {
  describeAnalysisModelContract,
  smallFeatureInput,
} from "../../application/testing/index.ts";
import recordingJson from "./fixtures/model-run-small-feature.synthetic.json" with { type: "json" };
import { createReplayAnalysisModel, ModelRecording, type SCENARIOS } from "./model-recording.ts";

const recording = ModelRecording.parse(recordingJson);
const model = (scenario?: (typeof SCENARIOS)[number]) =>
  createReplayAnalysisModel(recording, {
    ...(scenario === undefined ? {} : { scenario }),
    speed: 0,
  });

describeAnalysisModelContract("replayed recording", () => model());

describe("the replayed model's scenarios", () => {
  it("waits as long as the pass took, times the speed", async () => {
    const waits: number[] = [];
    const slow = createReplayAnalysisModel(recording, {
      scenario: "slow",
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    await slow.intent(smallFeatureInput);
    expect(waits).toEqual([recording.passes.intent.durationMs * 3]);
  });

  it("finds nothing", async () => {
    const findings = await model("nothing-found").findings(smallFeatureInput, null);
    expect(findings.ok && findings.value.value).toEqual([]);
  });

  it("makes 40 points, to test the list, Next and the tree", async () => {
    const result = await model("many").findings(smallFeatureInput, null);
    expect(result.ok && result.value.value).toHaveLength(40);
  });

  it("reaches the plan's limit after the intent, with when it resets", async () => {
    const limited = model("limit-after-intent");
    expect((await limited.intent(smallFeatureInput)).ok).toBe(true);
    const findings = await limited.findings(smallFeatureInput, null);
    expect(!findings.ok && findings.error).toMatchObject({ kind: "rate-limited" });
    expect(!findings.ok && findings.error.message).toContain("resets at");
  });

  it("declines the findings pass", async () => {
    const result = await model("refusal").findings(smallFeatureInput, null);
    expect(!result.ok && result.error.kind).toBe("refusal");
  });

  it("answers badly once, then well when the retry says what was wrong", async () => {
    const flaky = model("invalid-then-ok");
    const first = await flaky.findings(smallFeatureInput, null);
    const retry = await flaky.findings(smallFeatureInput, null, {
      feedback: ["Finding 1's lines"],
    });
    expect(first.ok && first.value.value[0]?.lines.startLine).toBe(100_000);
    expect(retry.ok && retry.value.value).toEqual(
      z.array(FindingDraft).parse(recording.passes.findings.answer),
    );
  });

  it("isn't signed in", async () => {
    const result = await model("not-signed-in").intent(smallFeatureInput);
    expect(!result.ok && result.error).toMatchObject({ kind: "unauthorized" });
  });
});
