import { describe, expect, it } from "vitest";
import { type AnalysisView, routes, TOKEN_HEADER } from "../../../contracts/index.ts";
import { FakeCodeParser, RecordingLogger } from "../../application/testing/index.ts";
import { following, pointsOf } from "../../domain/review/index.ts";
import { createFakeApp } from "./fake-app.ts";
import { receiptsChecked } from "./receipts-checked.ts";

const PORT = 4825;
const TOKEN = "fake-token";

const fakeApp = async () => {
  const fake = await createFakeApp({
    parser: new FakeCodeParser(),
    logger: new RecordingLogger(),
    version: "1.2.3-fake",
    staticDir: null,
    sessionToken: TOKEN,
  });
  const app = fake.app(PORT);
  const call = (path: string, init: { method?: string; body?: unknown } = {}) =>
    app.request(path, {
      method: init.method ?? "GET",
      headers: { host: `127.0.0.1:${PORT}`, [TOKEN_HEADER]: TOKEN },
      ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
    });
  return { fake, call };
};

describe("receipts-checked", () => {
  it("marks its finding with a Biome rule the config doesn't name", async () => {
    const { call } = await fakeApp();
    const settled = async (id: string): Promise<AnalysisView> => {
      for (;;) {
        const view = routes.getAnalysis.response.parse(
          await (await call(`/api/analyses/${id}`)).json(),
        );
        if (!following(view.analysis)) return view;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    };
    const started = routes.startAnalysis.response.parse(
      await (
        await call("/api/analyses", {
          method: "POST",
          body: { url: receiptsChecked.pullRequest.url },
        })
      ).json(),
    );
    await settled(started.analysisId);
    await call(`/api/analyses/${started.analysisId}/model`, { method: "POST", body: {} });
    const { analysis } = await settled(started.analysisId);

    expect(analysis.guidance?.checks).toEqual([
      { tool: "biome", path: "biome.json", bytes: expect.any(Number) },
    ]);
    expect(pointsOf(analysis).map((point) => point.guardrail)).toEqual([
      { is: "rule", tool: "biome", rule: "noMisusedPromises", configPath: "biome.json" },
    ]);
  });
});
