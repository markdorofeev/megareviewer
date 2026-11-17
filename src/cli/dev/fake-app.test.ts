import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ErrorResponse,
  PullRequestListResponse,
  routes,
  TOKEN_HEADER,
} from "../../../contracts/index.ts";
import {
  FakeAnalysisModel,
  FakeCodeParser,
  RecordingLogger,
  smallFeature,
  smallFeatureInput,
  smallFeaturePublication,
} from "../../application/testing/index.ts";
import { CommentKey, SignalKey } from "../../domain/review/index.ts";
import {
  createFakeApp,
  failingIntentOnce,
  fakeProposalDrafts,
  intentFailsOnce,
} from "./fake-app.ts";

const PORT = 4823;
const HOST = `127.0.0.1:${PORT}`;
const TOKEN = "fake-token";
const NEW_HEAD = "f".repeat(40);
const Publications = z.object({ attempts: z.array(z.object({ outcome: z.string() })) });

const setup = async () => {
  const fake = await createFakeApp({
    parser: new FakeCodeParser(),
    logger: new RecordingLogger(),
    version: "1.2.3-fake",
    staticDir: null,
    sessionToken: TOKEN,
  });
  const app = fake.app(PORT);
  const call = (path: string, init: { method?: string; body?: unknown; headers?: object } = {}) =>
    app.request(path, {
      method: init.method ?? "GET",
      headers: { host: HOST, [TOKEN_HEADER]: TOKEN, ...init.headers },
      ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
    });
  return { fake, call };
};

describe("createFakeApp", () => {
  it("serves the API with the given token, seeded with every fixture", async () => {
    const { fake, call } = await setup();
    expect(fake.composition.sessionToken).toBe(TOKEN);
    expect((await call("/api/status")).status).toBe(200);
    const list = PullRequestListResponse.parse(await (await call("/api/pull-requests")).json());
    expect(list.items.map((item) => item.url)).toContain(intentFailsOnce.pullRequest.url);
  });

  it("starts without preferences, and proposes two from the reviewer's three past comments", async () => {
    const { call } = await setup();
    const { repo } = smallFeature.pullRequest.ref;
    const view = routes.getPreferences.response.parse(
      await (await call("/api/preferences")).json(),
    );
    expect(view).toMatchObject({ preferences: [], proposals: [], signalsSinceSuggestion: 0 });

    const imported = routes.importPreferences.response.parse(
      await (await call("/api/preferences/imports", { method: "POST", body: { repo } })).json(),
    );

    expect(imported).toMatchObject({ comments: 3, pullRequests: 2 });
    expect(imported.proposals.map((one) => [one.text, one.source, one.scope])).toEqual([
      [fakeProposalDrafts[0]?.text, "imported", { kind: "repo", repo }],
      [fakeProposalDrafts[1]?.text, "imported", { kind: "global" }],
    ]);
  });

  it("proposes the same two from a recorded signal", async () => {
    const { fake, call } = await setup();
    await fake.preferences.recordSignal(SignalKey.parse("point:a:f1"), {
      kind: "dismissed",
      at: "2026-10-21T10:00:00.000Z",
      pullRequest: smallFeature.pullRequest.ref,
      pointKind: "finding",
      title: "Missing JSDoc on `parseConfig`",
      text: "",
      path: "src/config.ts",
    });

    const suggested = routes.suggestPreferences.response.parse(
      await (await call("/api/preferences/suggestions", { method: "POST" })).json(),
    );

    expect(suggested.signals).toBe(1);
    expect(suggested.proposals.map((one) => [one.text, one.source])).toEqual(
      fakeProposalDrafts.map((draft) => [draft.text, "learned"]),
    );
  });

  it("lists what the fake hosts received", async () => {
    const { fake, call } = await setup();
    expect(await (await call("/__fake/publications")).json()).toEqual({ attempts: [] });
    await fake.github.publish(smallFeature.pullRequest.ref, smallFeaturePublication, {
      headSha: smallFeature.pullRequest.headSha,
      alreadyPosted: new Set(),
      onPosted: async () => {},
    });
    const { attempts } = Publications.parse(await (await call("/__fake/publications")).json());
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.outcome).toBe("published");
  });

  it("fails the next publish at the given post", async () => {
    const { fake, call } = await setup();
    const response = await call("/__fake/fail-publish-comment", { method: "POST", body: { n: 2 } });
    expect(response.status).toBe(200);
    const posted: CommentKey[] = [];
    const result = await fake.github.publish(
      smallFeature.pullRequest.ref,
      smallFeaturePublication,
      {
        headSha: smallFeature.pullRequest.headSha,
        alreadyPosted: new Set(),
        onPosted: async (key) => {
          posted.push(key);
        },
      },
    );
    expect(result.ok).toBe(false);
    expect(posted).toEqual([CommentKey.parse("summary")]);
  });

  it("changes a PR's head SHA", async () => {
    const { fake, call } = await setup();
    const response = await call("/__fake/set-head", {
      method: "POST",
      body: { url: smallFeature.pullRequest.url, headSha: NEW_HEAD },
    });
    expect(response.status).toBe(200);
    const pullRequest = await fake.github.getPullRequest(smallFeature.pullRequest.ref);
    expect(pullRequest.ok && pullRequest.value.headSha).toBe(NEW_HEAD);
  });

  it.each([
    ["/__fake/fail-publish-comment", { n: 0 }],
    ["/__fake/fail-publish-comment", "not json"],
    ["/__fake/set-head", { url: smallFeature.pullRequest.url, headSha: "abc" }],
    ["/__fake/set-head", { url: "https://example.com/pr/1", headSha: NEW_HEAD }],
    ["/__fake/set-head", { url: "https://github.com/acme/none/pull/1", headSha: NEW_HEAD }],
  ])("rejects a bad request to %s", async (path, body) => {
    const { call } = await setup();
    const response = await call(path, { method: "POST", body });
    expect(response.status).toBe(400);
    expect(ErrorResponse.parse(await response.json()).error.code).toBe("bad-request");
  });

  it("protects the control routes like the API", async () => {
    const { call } = await setup();
    const noToken = await call("/__fake/publications", { headers: { [TOKEN_HEADER]: "wrong" } });
    expect(noToken.status).toBe(401);
    const foreign = await call("/__fake/publications", { headers: { host: "evil.example:4823" } });
    expect(foreign.status).toBe(403);
  });
});

describe("failingIntentOnce", () => {
  const forUrl = (url: string) => ({
    ...smallFeatureInput,
    pullRequest: { ...smallFeatureInput.pullRequest, url },
  });

  it("fails the first intent pass for its PR, then answers", async () => {
    const model = failingIntentOnce(new FakeAnalysisModel(), intentFailsOnce.pullRequest.url);
    const input = forUrl(intentFailsOnce.pullRequest.url);
    expect(await model.intent(input)).toMatchObject({ ok: false, error: { kind: "overloaded" } });
    expect((await model.intent(input)).ok).toBe(true);
  });

  it("answers other PRs, and delegates the other passes", async () => {
    const inner = new FakeAnalysisModel();
    const model = failingIntentOnce(inner, intentFailsOnce.pullRequest.url);
    const input = forUrl(smallFeature.pullRequest.url);
    const intent = await model.intent(input);
    expect(intent.ok).toBe(true);
    if (!intent.ok) return;
    await model.checkSize(input);
    await model.findings(input, intent.value.value);
    await model.risk(input);
    await model.decisions(input);
    expect(model.version).toBe(inner.version);
    expect(inner.calls.map((call) => call.pass)).toEqual([
      "intent",
      "checkSize",
      "findings",
      "risk",
      "decisions",
    ]);
  });
});
