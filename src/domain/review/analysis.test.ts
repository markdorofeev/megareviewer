import { describe, expect, it } from "vitest";
import { type Analysis, type AnalysisKey, analysisId, inProgress } from "./index.ts";

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
    ({ intent: status, findings: status, risk: status, decisions: status, tour: status }) as const;
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
