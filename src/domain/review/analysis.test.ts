import { describe, expect, it } from "vitest";
import { smallFeatureAnalysis } from "../../application/testing/index.ts";
import {
  Analysis,
  type AnalysisKey,
  analysisId,
  type Flow,
  following,
  inProgress,
  MODEL_STAGES,
  modelRunnable,
  runStages,
  withoutModelRun,
} from "./index.ts";

const key: AnalysisKey = {
  ref: { repo: { host: "github", owner: "acme", repo: "shop" }, number: 101 },
  headSha: "a".repeat(40),
  pipelineVersion: "1+claude-opus-5-5/p1",
};

describe("analysisId", () => {
  it("is stable for the same key", () => {
    expect(analysisId(key)).toBe(analysisId(structuredClone(key)));
    // Pinned so a change to the scheme, which orphans every cached analysis, is deliberate.
    expect(analysisId(key)).toBe("a_460f462eefd18cf8");
  });

  it.each([
    ["host", { ...key, ref: { ...key.ref, repo: { ...key.ref.repo, host: "bitbucket" } } }],
    ["owner", { ...key, ref: { ...key.ref, repo: { ...key.ref.repo, owner: "acme2" } } }],
    ["repo", { ...key, ref: { ...key.ref, repo: { ...key.ref.repo, repo: "shop2" } } }],
    ["number", { ...key, ref: { ...key.ref, number: 102 } }],
    ["head SHA", { ...key, headSha: "b".repeat(40) }],
    ["pipeline version", { ...key, pipelineVersion: "2+claude-opus-5-5/p1" }],
  ] satisfies [string, AnalysisKey][])("changes with the %s", (_, other) => {
    expect(analysisId(other)).not.toBe(analysisId(key));
  });

  it("has the AnalysisId shape", () => {
    expect(analysisId(key)).toMatch(/^a_[0-9a-f]{16}$/);
  });
});

describe("inProgress", () => {
  const codeStages = { collect: "done", prep: "done" } as const;
  const modelStages = (status: "pending" | "running" | "skipped") =>
    ({ intent: status, findings: status, risk: status, decisions: status, steps: status }) as const;
  const at = (
    status: Analysis["status"],
    stages: Analysis["stages"],
  ): Pick<Analysis, "status" | "stages"> => ({ status, stages });

  it("is while the code's stages run", () => {
    expect(inProgress(at("running", { ...codeStages, ...modelStages("pending") }))).toBe(true);
  });

  it("is while the model runs on a complete analysis", () => {
    expect(inProgress(at("complete", { ...codeStages, ...modelStages("running") }))).toBe(true);
    expect(inProgress(at("complete", { ...codeStages, ...modelStages("pending") }))).toBe(true);
  });

  it("isn't once the code's analysis is complete and the model hasn't run", () => {
    expect(inProgress(at("complete", { ...codeStages, ...modelStages("skipped") }))).toBe(false);
  });

  it("isn't once the code's stages failed, though the model's never left pending", () => {
    const stages = { collect: "done", prep: "failed", ...modelStages("pending") } as const;
    expect(inProgress(at("failed", stages))).toBe(false);
  });
});

describe("following", () => {
  const done = {
    collect: "done",
    prep: "done",
    intent: "done",
    findings: "done",
    risk: "done",
    decisions: "done",
    steps: "skipped",
  } as const;

  it("is while the analysis is in progress, or its run's guardrail call runs after the passes", () => {
    expect(following({ status: "running", stages: done, guardrails: null })).toBe(true);
    expect(following({ status: "complete", stages: done, guardrails: "running" })).toBe(true);
    expect(inProgress({ status: "complete", stages: done })).toBe(false);
  });

  it("isn't once the call has ended, or when the run made none", () => {
    for (const guardrails of [null, "done", "failed"] as const) {
      expect(following({ status: "complete", stages: done, guardrails })).toBe(false);
    }
  });
});

describe("the steps pass", () => {
  const ran = {
    collect: "done",
    prep: "done",
    intent: "done",
    findings: "done",
    risk: "done",
    decisions: "done",
  } as const;

  it("keeps the analysis in progress while it runs after the review's four", () => {
    expect(inProgress({ status: "complete", stages: { ...ran, steps: "running" } })).toBe(true);
    expect(inProgress({ status: "complete", stages: { ...ran, steps: "done" } })).toBe(false);
  });

  it("isn't counted by whether the model can run again", () => {
    expect(modelRunnable({ status: "complete", stages: { ...ran, steps: "failed" } })).toBe(false);
    expect(
      modelRunnable({ status: "complete", stages: { ...ran, risk: "failed", steps: "done" } }),
    ).toBe(true);
  });

  it("is one of a run's stages only when the run asked for the tour", () => {
    expect(runStages({ stages: { ...ran, steps: "skipped" } })).toEqual(MODEL_STAGES);
    expect(runStages({ stages: { ...ran, steps: "pending" } })).toEqual([...MODEL_STAGES, "steps"]);
  });

  it("is skipped, with no steps, on an analysis stored before it", () => {
    const { steps: _, stepsError: __, ...stored } = smallFeatureAnalysis;
    const { steps: ___, ...stages } = smallFeatureAnalysis.stages;
    const parsed = Analysis.parse({ ...stored, stages: { ...stages, tour: "done" } });
    expect(parsed.stages.steps).toBe("skipped");
    expect(parsed.stages).not.toHaveProperty("tour");
    expect(parsed.steps).toBeNull();
    expect(parsed.stepsError).toBeNull();
  });

  it("goes with the run when it's removed", () => {
    const withSteps: Analysis = {
      ...smallFeatureAnalysis,
      stages: { ...smallFeatureAnalysis.stages, steps: "failed" },
      steps: [],
      stepsError: { stage: "steps", code: "model-error", message: "No answer" },
    };
    const removed = withoutModelRun(
      withSteps,
      { risk: [], warnings: [] },
      smallFeatureAnalysis.updatedAt,
    );
    expect(removed.stages.steps).toBe("skipped");
    expect(removed.steps).toBeNull();
    expect(removed.stepsError).toBeNull();
  });
});

describe("the code's flows", () => {
  const { flows, ...rest } = smallFeatureAnalysis;
  /** A flow as the tour pass's analyses stored it: the model's title, the code's kept aside. */
  const old = (flow: Flow, at: number) => ({
    id: `s${at + 1}`,
    title: `The model's title ${at + 1}`,
    explanation: "Read by the code.",
    partIds: flow.partIds,
    kind: flow.kind,
    via: [],
    entries: flow.entries,
    codeTitle: flow.title,
    merged: [],
  });
  const stored = (fields: Record<string, unknown>) =>
    Analysis.parse(JSON.parse(JSON.stringify({ ...rest, ...fields })));

  it("load from an analysis stored with them under `tour`, titled by the code", () => {
    const parsed = stored({ tour: { steps: (flows ?? []).map(old), builtBy: "model" } });
    expect(parsed.flows).toEqual(flows);
    expect(parsed).not.toHaveProperty("tour");
  });

  it("load from `flows` stored as steps, and as the array they are now", () => {
    const steps = (flows ?? []).map((flow, at) => ({
      ...old(flow, at),
      title: flow.title,
      codeTitle: null,
    }));
    expect(stored({ flows: { steps, builtBy: "code" } }).flows).toEqual(flows);
    expect(stored({ flows }).flows).toEqual(flows);
    expect(stored({ flows: null }).flows).toBeNull();
  });
});
