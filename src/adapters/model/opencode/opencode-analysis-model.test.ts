import { describe, expect, it } from "vitest";
import {
  describeAnalysisModelContract,
  RecordingLogger,
  smallFeatureInput,
  smallFeatureIntent,
} from "../../../application/testing/index.ts";
import type { ModelErrorKind } from "../../../domain/review/index.ts";
import {
  createFakeOpencodeClient,
  recorded,
  sessionWith,
} from "./fixtures/fake-opencode-client.ts";
import { createOpencodeAnalysisModel, OVERHEAD_TOKENS } from "./opencode-analysis-model.ts";
import { readTurn } from "./opencode-output.ts";
import { AGENT, PR_ENTRY } from "./opencode-request.ts";

const HAIKU_VARIANTS = ["none", "low", "medium", "high", "xhigh", "max"];

const modelWith = (
  answer?: Parameters<typeof createFakeOpencodeClient>[0],
  options: { priced?: boolean; contextTokens?: number } = {},
) => {
  const fake = createFakeOpencodeClient(answer);
  const logger = new RecordingLogger();
  const model = createOpencodeAnalysisModel({
    client: fake.client,
    // The fixtures were recorded on Haiku 5.5 through the Anthropic provider.
    providerID: "anthropic",
    model: "claude-haiku-5-5",
    variants: HAIKU_VARIANTS,
    contextTokens: options.contextTokens ?? 1_000_000,
    priced: options.priced ?? true,
    logger,
  });
  return { model, calls: fake.calls, logger };
};

describeAnalysisModelContract("opencode", () => modelWith().model);

/** The recorded intent session with its answer's text replaced. */
const intentSaying = (text: string) =>
  sessionWith("intent", (messages) =>
    messages.map((message) =>
      message.type === "assistant" ? { ...message, content: [{ type: "text", text }] } : message,
    ),
  );

/** The recorded intent session with `items` added to its answer. */
const intentAlso = (...items: Record<string, unknown>[]) =>
  sessionWith("intent", (messages) =>
    messages.map((message) =>
      message.type === "assistant" && Array.isArray(message.content)
        ? { ...message, content: [...items, ...message.content] }
        : message,
    ),
  );

const intentWith = async (answer: unknown) => {
  const setup = modelWith(() => answer);
  return { ...setup, result: await setup.model.intent(smallFeatureInput) };
};

const expectFailure = async (answer: unknown, kind: ModelErrorKind, message?: RegExp) => {
  const { result, calls } = await intentWith(answer);
  if (result.ok) throw new Error("expected the pass to fail");
  expect(result.error.kind).toBe(kind);
  if (message !== undefined) expect(result.error.message).toMatch(message);
  return calls;
};

const recordedIntentText = () => {
  const text = readTurn(recorded("intent"))?.text;
  if (text === undefined || text === null) throw new Error("no answer in the recorded intent");
  return text;
};

describe("OpencodeAnalysisModel", () => {
  it("has a version of its own that names the provider and model", () => {
    expect(modelWith().model.version).toMatch(/^opencode\/anthropic\/claude-haiku-5-5\/p\d+$/);
  });

  it("runs every pass as megareviewer's agent, the PR in the same entry, each at its effort", async () => {
    const { model, calls } = modelWith();
    await model.intent(smallFeatureInput);
    await model.risk(smallFeatureInput, smallFeatureIntent);
    await model.decisions(smallFeatureInput, smallFeatureIntent);

    const created = calls.filter((call) => call.method === "POST" && call.path === "/api/session");
    expect(created.map((call) => call.body)).toEqual(
      ["medium", "low", "high"].map((variant) => ({
        agent: AGENT,
        title: "megareviewer",
        model: { providerID: "anthropic", id: "claude-haiku-5-5", variant },
      })),
    );
    const entries = calls.filter((call) => call.path.endsWith(`/entries/${PR_ENTRY}-00`));
    expect(entries).toHaveLength(3);
    expect(new Set(entries.map((call) => JSON.stringify(call.body))).size).toBe(1);
    expect(JSON.stringify(entries[0]?.body)).toContain("<pull_request_data>");

    const prompts = calls.filter((call) => call.path.endsWith("/prompt"));
    expect(JSON.stringify(prompts[1]?.body)).toMatch(/Task: risk\./);
    expect(JSON.stringify(prompts[1]?.body)).toContain("<earlier_results>");
    expect(JSON.stringify(prompts[1]?.body)).toContain('\\"const\\":\\"risk\\"');
    expect(JSON.stringify(prompts[1]?.body)).not.toContain('\\"const\\":\\"intent\\"');
  });

  it("deletes each pass's session, answered or not", async () => {
    const answered = modelWith();
    await answered.model.intent(smallFeatureInput);
    expect(answered.calls.at(-1)).toMatchObject({
      method: "DELETE",
      path: "/api/session/ses_fake1",
    });

    const calls = await expectFailure(recorded("provider-error"), "unexpected");
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", path: "/api/session/ses_fake1" });
  });

  it("reports what the pass used and what opencode says it cost, billed to the reviewer's key", async () => {
    const { result } = await intentWith(recorded("intent"));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.usage).toEqual({
      pass: "intent",
      inputTokens: 4,
      cacheReadTokens: expect.any(Number),
      cacheWriteTokens: expect.any(Number),
      outputTokens: expect.any(Number),
      costUsd: expect.any(Number),
      billing: "api",
    });
    expect(result.value.usage.costUsd).toBeGreaterThan(0);
  });

  it("leaves the cost unknown for a model opencode doesn't price", async () => {
    const setup = modelWith(undefined, { priced: false });
    const result = await setup.model.intent(smallFeatureInput);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.usage.costUsd).toBeNull();
  });

  it("reads an answer wrapped in a code fence or a sentence", async () => {
    const json = recordedIntentText();
    for (const text of [`\`\`\`json\n${json}\n\`\`\``, `Here is the answer:\n${json}`]) {
      const { result } = await intentWith(intentSaying(text));
      expect(result.ok).toBe(true);
    }
  });

  it("fails an answer that isn't JSON, or isn't the pass's, as invalid output", async () => {
    await expectFailure(intentSaying("I can't do that."), "invalid-output", /one JSON object/);
    await expectFailure(
      intentSaying('{"answer":{"pass":"risk","assessments":[]}}'),
      "invalid-output",
      /answered the risk task instead of intent/,
    );
  });

  describe("lockdown", () => {
    it.each<[string, unknown]>([
      [
        "a tool call",
        intentAlso({ type: "tool", id: "t1", name: "skill", executed: false, state: {} }),
      ],
      ["a content item of a kind it doesn't know", intentAlso({ type: "image" })],
      [
        "a shell",
        sessionWith("intent", (messages) => [
          { type: "shell", command: "curl http://127.0.0.1:8766", status: "exited" },
          ...messages,
        ]),
      ],
      [
        "a skill loaded",
        sessionWith("intent", (messages) => [
          { type: "skill", name: "deploy", text: "…" },
          ...messages,
        ]),
      ],
      [
        "a second step",
        sessionWith("intent", (messages) => [
          ...messages,
          ...messages.filter((message) => message.type === "assistant"),
        ]),
      ],
    ])("discards the answer of a session with %s", async (_, session) => {
      const calls = await expectFailure(session, "unexpected", /used a tool/);
      expect(calls.at(-1)?.method).toBe("DELETE");
    });

    it("keeps the answer of a session with only reasoning and text", async () => {
      const { result } = await intentWith(intentAlso({ type: "reasoning", text: "thinking" }));
      expect(result.ok).toBe(true);
    });
  });

  describe("errors", () => {
    it("passes the provider's own failure through", async () => {
      await expectFailure(recorded("provider-error"), "unexpected", /assistant message prefill/);
      await expectFailure(recorded("unreachable"), "network", /can't reach the provider/);
    });

    it.each<[Record<string, unknown>, ModelErrorKind]>([
      [{ type: "provider.auth", message: "invalid x-api-key", status: 401 }, "unauthorized"],
      [{ type: "provider.rate-limit", message: "Too many requests", status: 429 }, "rate-limited"],
      [
        { type: "provider.context-overflow", message: "prompt is too long", status: 400 },
        "too-large",
      ],
      [{ type: "provider.overloaded", message: "Overloaded", status: 529 }, "overloaded"],
      [{ type: "provider.content-filter", message: "blocked" }, "refusal"],
    ])("maps %o to %s", async (error, kind) => {
      await expectFailure(
        sessionWith("intent", (messages) =>
          messages.map((message) =>
            message.type === "assistant" ? { ...message, content: [], error } : message,
          ),
        ),
        kind,
      );
    });

    it("says an answer cut off at the output limit is", async () => {
      await expectFailure(
        sessionWith("intent", (messages) =>
          messages.map((message) =>
            message.type === "assistant" ? { ...message, finish: "length" } : message,
          ),
        ),
        "max-tokens",
      );
    });

    it("stops a pass that doesn't finish, and says so", async () => {
      const calls = await expectFailure({ fail: { kind: "timeout" } }, "unexpected", /10 minutes/);
      expect(calls.map((call) => call.path)).toContain("/api/session/ses_fake1/interrupt");
    });

    it("says how to install opencode when it isn't", async () => {
      await expectFailure(
        { fail: { kind: "server", problem: { kind: "not-installed", message: "x" } } },
        "unauthorized",
        /isn't installed/,
      );
    });
  });

  it("estimates the input high and refuses a PR over the model's context", async () => {
    const measured = await modelWith().model.checkSize(smallFeatureInput);
    if (!measured.ok) throw new Error(measured.error.message);
    expect(measured.value.inputTokens).toBeGreaterThan(OVERHEAD_TOKENS);

    const small = await modelWith(undefined, { contextTokens: 34_000 }).model.checkSize(
      smallFeatureInput,
    );
    expect(small.ok ? null : small.error.kind).toBe("too-large");
  });
});
