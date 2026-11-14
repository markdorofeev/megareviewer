import { describe, expect, it } from "vitest";
import { AnalysisView, PullRequestListResponse, StatusResponse } from "../../../contracts/index.ts";
import { hunkIdOf } from "../../../src/domain/diff/index.ts";
import {
  pointLinesFit,
  validateHunkReferences,
  validateRiskCoverage,
  validateTour,
} from "../../../src/domain/review/index.ts";
import {
  fixtureAnalysisView,
  fixturePullRequests,
  fixtureStatus,
  largeAnalysisView,
} from "./index.ts";

describe("mock fixtures", () => {
  it("match the HTTP API contract", () => {
    expect(StatusResponse.parse(fixtureStatus)).toEqual(fixtureStatus);
    expect(PullRequestListResponse.parse(fixturePullRequests)).toEqual(fixturePullRequests);
    expect(AnalysisView.parse(fixtureAnalysisView)).toEqual(fixtureAnalysisView);
  });

  it("have GitHub configured and Bitbucket not", () => {
    expect(fixtureStatus.hosts.github.configured).toBe(true);
    expect(fixtureStatus.hosts.bitbucket.configured).toBe(false);
  });

  it("list 6 PRs across both hosts and both roles", () => {
    const { items } = fixturePullRequests;
    expect(items).toHaveLength(6);
    expect(new Set(items.map((item) => item.ref.repo.host))).toEqual(
      new Set(["github", "bitbucket"]),
    );
    expect(new Set(items.map((item) => item.role))).toEqual(new Set(["reviewer", "author"]));
  });
});

describe("the fixture analysis", () => {
  const { analysis } = fixtureAnalysisView;
  const hunks = analysis.files.flatMap((file) => file.hunks);
  const hunkIds = new Set(hunks.map((hunk) => hunk.id));
  const provedIds = new Set(analysis.proofs.flatMap((proof) => proof.hunkId ?? []));
  const reviewedIds = new Set([...hunkIds].filter((id) => !provedIds.has(id)));

  it("has about 10 hunks over about 5 files", () => {
    expect(hunks.length).toBeGreaterThanOrEqual(9);
    expect(hunks.length).toBeLessThanOrEqual(12);
    expect(analysis.files.length).toBeGreaterThanOrEqual(5);
  });

  it("proves a move, a lockfile, a formatting-only file and a pure rename", () => {
    const kinds = analysis.proofs.map((proof) => proof.kind);
    expect(kinds).toEqual(expect.arrayContaining(["move", "generated", "formatting", "rename"]));
    expect(analysis.proofs.find((proof) => proof.kind === "rename")?.hunkId).toBeNull();
  });

  it("has a risk class on every hunk, at least two of them contract", () => {
    expect(validateRiskCoverage(analysis.risk, hunkIds)).toEqual([]);
    const contract = analysis.risk.filter((assessment) => assessment.riskClass === "contract");
    expect(contract.length).toBeGreaterThanOrEqual(2);
    for (const assessment of analysis.risk) {
      expect(assessment.riskClass === "mechanical").toBe(provedIds.has(assessment.hunkId));
    }
  });

  it("has stated and inferred intent and one mismatch", () => {
    expect(analysis.intent?.stated).not.toBeNull();
    expect(analysis.intent?.inferred.behaviorChanges.length).toBeGreaterThan(0);
    expect(analysis.intent?.mismatches).toHaveLength(1);
  });

  it("has 4 decisions across categories, each on a line its hunks show", () => {
    expect(analysis.decisions).toHaveLength(4);
    expect(new Set(analysis.decisions.map((decision) => decision.category)).size).toBe(4);
    const hunks = new Map(
      analysis.files.flatMap((file) => file.hunks.map((hunk) => [hunk.id, hunk] as const)),
    );
    for (const decision of analysis.decisions) {
      expect(decision.lines).not.toBeNull();
      if (decision.lines === null) continue;
      expect(pointLinesFit(decision.hunkIds, decision.lines, hunks)).toBe(true);
    }
  });

  it("has a 4-step tour covering every part of every non-mechanical hunk once", () => {
    expect(analysis.tour?.steps).toHaveLength(4);
    expect(validateTour(analysis.tour ?? { steps: [] }, reviewedIds, analysis.parts)).toEqual([]);
  });

  it("references only hunks that exist", () => {
    const referenced = [
      ...analysis.decisions.flatMap((decision) => decision.hunkIds),
      ...(analysis.intent?.mismatches.flatMap((mismatch) => mismatch.hunkIds) ?? []),
      ...analysis.callGraph.flatMap((hint) => [hunkIdOf(hint.fromPartId), hunkIdOf(hint.toPartId)]),
    ];
    expect(validateHunkReferences(hunkIds, referenced)).toEqual([]);
  });

  it("has two warnings and usage for every pass", () => {
    expect(analysis.warnings).toHaveLength(2);
    expect(analysis.usage.map((usage) => usage.pass)).toEqual(["intent", "risk", "decisions"]);
  });
});

describe.each([
  ["fixture", fixtureAnalysisView],
  ["large fixture", largeAnalysisView],
])("the %s's call sites", (_, { analysis }) => {
  it("mark a call's symbol on its line, one per call hint", () => {
    const lines = analysis.files.flatMap((file) =>
      file.hunks.flatMap((hunk) => hunk.lines.map((line) => ({ path: file.path, line }))),
    );
    for (const site of analysis.callSites) {
      const { line } = lines.find(
        ({ path, line }) => path === site.path && line.kind !== "del" && line.newLine === site.line,
      ) ?? { line: null };
      expect(line?.text.slice(site.column, site.column + site.length)).toBe(site.symbol);
    }
    expect(analysis.callSites).toHaveLength(
      analysis.callGraph.filter((hint) => hint.use === "call").length,
    );
  });
});

describe("the large fixture analysis", () => {
  const { analysis } = largeAnalysisView;
  const hunks = analysis.files.flatMap((file) => file.hunks);
  const hunkIds = new Set(hunks.map((hunk) => hunk.id));

  it("matches the HTTP API contract, with 240 hunks the tour and risk cover", () => {
    expect(AnalysisView.parse(largeAnalysisView)).toEqual(largeAnalysisView);
    expect(hunks).toHaveLength(240);
    expect(validateRiskCoverage(analysis.risk, hunkIds)).toEqual([]);
    expect(analysis.tour && validateTour(analysis.tour, hunkIds)).toEqual([]);
  });

  it("puts every call on a line its calling hunk shows", () => {
    for (const hint of analysis.callGraph) {
      const from = hunks.find((hunk) => hunk.id === hint.fromPartId);
      const line = from?.lines.find((one) => one.newLine === hint.line);
      expect(line?.text).toContain(`${hint.symbol}(input)`);
    }
  });
});
