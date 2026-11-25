import { describe, expect, it } from "vitest";
import { type AnalysisView, routes, TOKEN_HEADER } from "../../../contracts/index.ts";
import { FakeCodeParser, RecordingLogger } from "../../application/testing/index.ts";
import { inProgress, pointsOf } from "../../domain/review/index.ts";
import { createFakeApp } from "./fake-app.ts";
import { guidedPreferences, receiptsGuided, seedGuidedPreferences } from "./receipts-guided.ts";

const PORT = 4824;
const TOKEN = "fake-token";
const AT = "2026-11-01T09:00:00.000Z";
const { repo } = receiptsGuided.pullRequest.ref;

/** The guided PR after its AI review, on a fake app whose preferences `seed` saved first. */
const reviewed = async (
  seed: (fake: Awaited<ReturnType<typeof createFakeApp>>) => Promise<void>,
) => {
  const fake = await createFakeApp({
    parser: new FakeCodeParser(),
    logger: new RecordingLogger(),
    version: "1.2.3-fake",
    staticDir: null,
    sessionToken: TOKEN,
  });
  await seed(fake);
  const app = fake.app(PORT);
  const call = (path: string, init: { method?: string; body?: unknown } = {}) =>
    app.request(path, {
      method: init.method ?? "GET",
      headers: { host: `127.0.0.1:${PORT}`, [TOKEN_HEADER]: TOKEN },
      ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
    });
  const settled = async (id: string): Promise<AnalysisView> => {
    for (;;) {
      const view = routes.getAnalysis.response.parse(
        await (await call(`/api/analyses/${id}`)).json(),
      );
      if (!inProgress(view.analysis)) return view;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  const started = routes.startAnalysis.response.parse(
    await (
      await call("/api/analyses", { method: "POST", body: { url: receiptsGuided.pullRequest.url } })
    ).json(),
  );
  await settled(started.analysisId);
  await call(`/api/analyses/${started.analysisId}/model`, { method: "POST", body: {} });
  const { analysis } = await settled(started.analysisId);
  const preferences = routes.getPreferences.response.parse(
    await (await call("/api/preferences")).json(),
  );
  return { analysis, preferences };
};

const marks = (analysis: AnalysisView["analysis"]) =>
  pointsOf(analysis).map((point) => [
    point.guidance?.effect ?? null,
    point.guidance?.label ?? null,
  ]);

describe("receipts-guided", () => {
  it("has a finding a preference raised, one from REVIEW.md, and one left out", async () => {
    const { analysis, preferences } = await reviewed((fake) =>
      seedGuidedPreferences(fake.preferences, AT),
    );
    expect(analysis.guidance?.preferences.map((one) => [one.ref, one.kind, one.text])).toEqual([
      ["p1", "look-for", "Caches with nothing that invalidates them"],
      ["p2", "dont-flag", "Naming"],
    ]);
    expect(analysis.guidance?.guidelines.map((file) => [file.ref, file.path])).toEqual([
      ["g1", "REVIEW.md"],
    ]);
    expect(marks(analysis)).toEqual([
      ["raised", "Caches with nothing that invalidates them"],
      ["raised", "REVIEW.md"],
      ["left-out", "Naming"],
    ]);
    // CLAUDE.md is over what a guideline file can be, which the preferences page says.
    const files = preferences.repositories.find((one) => one.repo.repo === repo.repo);
    expect(files?.guidelineFiles?.map((file) => [file.path, file.enabled, file.tooLarge])).toEqual([
      ["REVIEW.md", true, false],
      ["CLAUDE.md", false, true],
      ["CONTRIBUTING.md", false, false],
    ]);
  });

  it("numbers its marks by what the run was given, after the reviewer's own preferences", async () => {
    const { analysis } = await reviewed(async (fake) => {
      const [first] = guidedPreferences("2026-10-01T09:00:00.000Z");
      if (first === undefined) throw new Error("the guided PR has preferences");
      await fake.preferences.savePreference({
        ...first,
        text: "Money as floats",
        scope: { kind: "global" },
      });
      await seedGuidedPreferences(fake.preferences, AT);
    });
    expect(analysis.guidance?.preferences.map((one) => one.ref)).toEqual(["p1", "p2", "p3"]);
    expect(marks(analysis)).toEqual([
      ["raised", "Caches with nothing that invalidates them"],
      ["raised", "REVIEW.md"],
      ["left-out", "Naming"],
    ]);
  });

  it("marks nothing by a preference the run wasn't given", async () => {
    const { analysis } = await reviewed(async (fake) => {
      await fake.preferences.setGuidelineSwitch(repo, "REVIEW.md", false);
    });
    expect(analysis.guidance).toEqual({ preferences: [], guidelines: [], checks: [] });
    expect(marks(analysis)).toEqual([
      [null, null],
      [null, null],
      [null, null],
    ]);
  });
});
