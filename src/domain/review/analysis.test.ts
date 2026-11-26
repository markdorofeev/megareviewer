import { describe, expect, it } from "vitest";
import { smallFeatureAnalysis } from "../../application/testing/index.ts";
import v20 from "./fixtures/analysis-v20.json" with { type: "json" };
import {
  Analysis,
  type AnalysisKey,
  analysisId,
  type Flow,
  following,
  inProgress,
  MODEL_STAGES,
  modelRunnable,
  PointReview,
  pointsOf,
  ReviewSignal,
  runStages,
  withoutModelRun,
} from "./index.ts";

const key: AnalysisKey = {
  ref: { repo: { host: "github", owner: "acme", repo: "shop" }, number: 101 },
  headSha: "a".repeat(40),
  pipelineVersion: "1+claude-opus-5-5/p1",
};

describe("checkoutDir", () => {
  it("is null on an analysis stored before it", () => {
    const { checkoutDir: _, ...stored } = smallFeatureAnalysis;
    expect(Analysis.parse(stored).checkoutDir).toBeNull();
  });
});

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
    ({ intent: status, findings: status, steps: status }) as const;
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
    steps: "skipped",
  } as const;

  it("is while the analysis is in progress, or its run's guardrail call runs after the passes", () => {
    expect(following({ status: "running", stages: done, guardrails: null, checkout: "none" })).toBe(
      true,
    );
    expect(
      following({ status: "complete", stages: done, guardrails: "running", checkout: "read" }),
    ).toBe(true);
    expect(inProgress({ status: "complete", stages: done })).toBe(false);
  });

  it("is while the commit its callers are read from downloads, and the analysis isn't in progress", () => {
    const downloading = { stages: done, guardrails: null, checkout: "downloading" } as const;
    expect(following({ status: "complete", ...downloading })).toBe(true);
    expect(following({ status: "failed", ...downloading })).toBe(false);
  });

  it("isn't once the call and the download have ended, or when there were none", () => {
    for (const guardrails of [null, "done", "failed"] as const) {
      for (const checkout of ["read", "none", "missing-commit", "download-failed"] as const) {
        expect(following({ status: "complete", stages: done, guardrails, checkout })).toBe(false);
      }
    }
  });
});

describe("the steps pass", () => {
  const ran = {
    collect: "done",
    prep: "done",
    intent: "done",
    findings: "done",
  } as const;

  it("keeps the analysis in progress while it runs after the review's two", () => {
    expect(inProgress({ status: "complete", stages: { ...ran, steps: "running" } })).toBe(true);
    expect(inProgress({ status: "complete", stages: { ...ran, steps: "done" } })).toBe(false);
  });

  it("isn't counted by whether the model can run again", () => {
    expect(modelRunnable({ status: "complete", stages: { ...ran, steps: "failed" } })).toBe(false);
    expect(
      modelRunnable({ status: "complete", stages: { ...ran, findings: "failed", steps: "done" } }),
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
    const removed = withoutModelRun(withSteps, { warnings: [] }, smallFeatureAnalysis.updatedAt);
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

describe("an analysis stored with risks, a checking test and decisions", () => {
  const stored = v20.analysis;

  it("shows its findings and its brief, and no risk or decision", () => {
    const parsed = Analysis.parse(stored);
    expect(pointsOf(parsed).map((point) => point.id)).toEqual(["f1", "m1", "m2"]);
    expect(pointsOf(parsed)[0]?.guardrail).toBeDefined();
    expect(parsed.intent?.inferred.summary).toBe(stored.intent.inferred.summary);
    expect(parsed).not.toHaveProperty("decisions");
    for (const risk of parsed.risk) {
      expect(Object.keys(risk).sort()).toEqual(["hunkId", "reason", "riskClass", "source"]);
    }
  });

  it("has the stages of the passes there are, done, and the calls it made", () => {
    const parsed = Analysis.parse(stored);
    expect(parsed.stages).toEqual({
      collect: "done",
      prep: "done",
      intent: "done",
      findings: "done",
      steps: "skipped",
    });
    expect(modelRunnable(parsed)).toBe(false);
    expect(parsed.usage.map((usage) => usage.pass)).toEqual(["intent", "risk", "decisions"]);
    expect(parsed.modelCalls.map((call) => call.pass)).toEqual(["intent", "risk", "decisions"]);
  });

  it("gets the code's risk back when its run is removed", () => {
    const parsed = Analysis.parse(stored);
    expect(parsed.beforeModel?.risk?.every((risk) => risk.source === "rule")).toBe(true);
    const removed = withoutModelRun(
      parsed,
      parsed.beforeModel ?? { warnings: [] },
      parsed.updatedAt,
    );
    expect(removed.risk).toEqual(parsed.beforeModel?.risk);
  });

  it("keeps the risk it has when its run kept none", () => {
    const parsed = Analysis.parse({ ...stored, beforeModel: { warnings: [] } });
    const removed = withoutModelRun(parsed, { warnings: [] }, parsed.updatedAt);
    expect(removed.risk).toEqual(parsed.risk);
  });

  it("drops the error of a pass that's gone, unless the findings or the intent didn't finish", () => {
    const modelError = { stage: "risk", code: "model-error", message: "Overloaded" };
    expect(Analysis.parse({ ...stored, modelError }).modelError).toBeNull();
    const stages = { ...stored.stages, findings: "failed" };
    expect(Analysis.parse({ ...stored, stages, modelError }).modelError).toEqual({
      ...modelError,
      stage: "findings",
    });
  });

  it("keeps the states and signals of its risks and decisions readable", () => {
    expect(v20.pointReviews.map((review) => PointReview.parse(review).pointId)).toEqual(
      v20.pointReviews.map((review) => review.pointId),
    );
    expect(v20.signals.map((signal) => ReviewSignal.parse(signal).pointKind)).toEqual([
      "risk",
      "decision",
    ]);
  });
});
