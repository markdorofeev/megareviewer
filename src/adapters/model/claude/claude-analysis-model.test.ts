import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  describeAnalysisModelContract,
  RecordingLogger,
  smallFeatureInput,
  smallFeatureIntent,
} from "../../../application/testing/index.ts";
import type { ModelErrorKind, ModelPass } from "../../../domain/review/index.ts";
import { createClaudeAnalysisModel } from "./claude-analysis-model.ts";
import { createAnthropicFetch, type FixtureAnswer } from "./fixtures/anthropic-fetch.ts";
import errors from "./fixtures/errors.synthetic.json" with { type: "json" };
import smallFeature from "./fixtures/small-feature.synthetic.json" with { type: "json" };
import { costUsd, HIGHEST_PRICE, PRICES } from "./pricing.ts";
import { PROMPT_VERSION } from "./version.ts";

type Answers = Parameters<typeof createAnthropicFetch>[0];

/** The fixtures were recorded on Haiku 5.5. */
const modelWith = (answers: Answers, options: { maxInputTokens?: number; model?: string } = {}) => {
  const { fetch, requests } = createAnthropicFetch(answers);
  const logger = new RecordingLogger();
  const client = new Anthropic({ apiKey: "test-key", fetch, maxRetries: 0 });
  const model = createClaudeAnalysisModel({
    client,
    logger,
    model: "claude-haiku-5-5",
    ...options,
  });
  return { model, requests, logger };
};

const recorded = (): Answers => smallFeature;

/** Runs one pass of the small-feature fixture, answered with `answer`. */
const runPass = (pass: ModelPass, answer: FixtureAnswer, feedback?: readonly string[]) => {
  const setup = modelWith({ passes: { [pass]: answer } });
  const { model } = setup;
  const options = feedback === undefined ? undefined : { feedback };
  const result =
    pass === "intent"
      ? model.intent(smallFeatureInput, options)
      : pass === "risk"
        ? model.risk(smallFeatureInput, options)
        : pass === "decisions"
          ? model.decisions(smallFeatureInput, options)
          : model.findings(smallFeatureInput, smallFeatureIntent, options);
  return { ...setup, result };
};

describeAnalysisModelContract("claude", () => modelWith(recorded()).model);

describe("ClaudeAnalysisModel", () => {
  it("says once that the answer has begun, at the stream's first event", async () => {
    let answering = 0;
    const result = await modelWith(recorded()).model.intent(smallFeatureInput, {
      onAnswering: () => {
        answering += 1;
      },
    });
    expect(result.ok).toBe(true);
    expect(answering).toBe(1);
  });

  it("names the model and the prompt version", () => {
    expect(modelWith({}).model.version).toBe(`claude-haiku-5-5/p${PROMPT_VERSION}`);
    expect(modelWith({}, { model: "claude-opus-5-5" }).model.version).toBe(
      `claude-opus-5-5/p${PROMPT_VERSION}`,
    );
  });

  describe("requests", () => {
    const runAllPasses = async () => {
      const { model, requests } = modelWith(recorded());
      await model.intent(smallFeatureInput);
      await model.risk(smallFeatureInput);
      await model.decisions(smallFeatureInput);
      return requests;
    };

    it("sends every pass the same prefix, up to a cache breakpoint after the PR data", async () => {
      const requests = await runAllPasses();
      expect(requests).toHaveLength(3);
      const prefix = (index: number) => {
        const body = requests[index]?.body;
        return JSON.stringify([
          body?.model,
          body?.system,
          body?.thinking,
          body?.output_config,
          body?.messages[0],
        ]);
      };
      for (const index of [1, 2]) expect(prefix(index)).toBe(prefix(0));

      const data = requests[0]?.body.messages[0];
      expect(data?.role).toBe("user");
      expect(data?.content).toEqual([
        {
          type: "text",
          text: expect.stringMatching(/^<pull_request_data>[\s\S]*<\/pull_request_data>$/),
          cache_control: { type: "ephemeral" },
        },
      ]);
    });

    it("sets each pass's effort after the cached prefix", async () => {
      const requests = await runAllPasses();
      expect(requests.map((request) => request.body.messages[1])).toEqual(
        ["medium", "low", "high"].map((effort) => ({
          role: "system",
          content: [],
          output_config: { effort },
        })),
      );
    });

    it("streams Haiku 5.5, which has no refusal fallbacks, with the beta for per-pass effort", async () => {
      const [request] = await runAllPasses();
      expect(request?.body).not.toHaveProperty("fallbacks");
      expect(request?.body).toMatchObject({
        model: "claude-haiku-5-5",
        max_tokens: 64_000,
        stream: true,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium", format: { type: "json_schema" } },
      });
      expect(request?.headers.get("anthropic-beta")?.split(",")).toEqual([
        "mid-conversation-output-config-2026-07-01",
      ]);
    });

    it("asks each pass for its own task alone, so the passes can run side by side", async () => {
      const requests = await runAllPasses();
      const instructions = requests.map(
        (request) => request.body.messages[2]?.content[0]?.text ?? "",
      );
      expect(instructions.map((text) => /^Task: (\w+)\./.exec(text)?.[1])).toEqual([
        "intent",
        "risk",
        "decisions",
      ]);
      for (const text of instructions) expect(text).not.toContain("<earlier_results>");
    });

    it("appends the feedback on the previous answer when given", async () => {
      const instruction = async (feedback?: readonly string[]) => {
        const { result, requests } = runPass("risk", smallFeature.passes.risk, feedback);
        await result;
        return requests[0]?.body.messages[2]?.content[0]?.text ?? "";
      };
      expect(await instruction(["h_1 is not a hunk", "h_2 missing"])).toMatch(
        /\n\nYour previous answer had these problems: h_1 is not a hunk; h_2 missing\. Fix them\.$/,
      );
      expect(await instruction()).toMatch(/^Task: risk\.$/m);
      expect(await instruction()).not.toContain("previous answer");
    });
  });

  describe("usage", () => {
    it("reports tokens and cost per pass", async () => {
      const { result, logger } = runPass("risk", smallFeature.passes.risk);
      const output = await result;
      if (!output.ok) throw new Error(output.error.message);

      const tokens = {
        inputTokens: 238,
        cacheReadTokens: 6012,
        cacheWriteTokens: 0,
        outputTokens: 261,
      };
      const price = PRICES["claude-haiku-5-5"];
      if (price === undefined) throw new Error("no price for the model");
      expect(output.value.usage).toEqual({
        pass: "risk",
        ...tokens,
        costUsd: costUsd(price, tokens),
        billing: "api",
      });
      expect(logger.entries).toContainEqual(
        expect.objectContaining({
          level: "info",
          fields: expect.objectContaining({ pass: "risk", model: "claude-haiku-5-5" }),
        }),
      );
    });

    it("prices a model missing from the table at the highest known prices", async () => {
      const message = { ...smallFeature.passes.intent, model: "claude-future-1" };
      const { result, logger } = runPass("intent", message);
      const output = await result;
      if (!output.ok) throw new Error(output.error.message);

      expect(output.value.usage.costUsd).toBe(costUsd(HIGHEST_PRICE, output.value.usage));
      expect(logger.entries).toContainEqual(
        expect.objectContaining({ level: "warn", fields: { model: "claude-future-1" } }),
      );
    });
  });

  describe("errors", () => {
    const failsWith = async (
      pass: ModelPass,
      answer: FixtureAnswer,
      kind: ModelErrorKind,
      message?: RegExp,
    ) => {
      const output = await runPass(pass, answer).result;
      if (output.ok) throw new Error("expected the pass to fail");
      expect(output.error.kind).toBe(kind);
      if (message !== undefined) expect(output.error.message).toMatch(message);
    };

    it("reports a refusal with its category", () =>
      failsWith("intent", errors.messages.refusal, "refusal", /category: cyber/));

    it("reports an answer cut off at the output limit", () =>
      failsWith("decisions", errors.messages.maxTokens, "max-tokens", /64000/));

    it("reports an answer that isn't JSON", () =>
      failsWith("intent", errors.messages.malformed, "invalid-output", /isn't JSON/));

    it("reports an answer outside the schema", () =>
      failsWith("risk", errors.messages.outsideSchema, "invalid-output", /riskClass/));

    it("reports an answer to another pass", () =>
      failsWith(
        "risk",
        errors.messages.wrongPass,
        "invalid-output",
        /intent task instead of risk/,
      ));

    it.each([
      ["unauthorized", errors.http.unauthorized, "unauthorized"],
      ["forbidden", errors.http.forbidden, "unauthorized"],
      ["rate-limited", errors.http.rateLimited, "rate-limited"],
      ["overloaded", errors.http.overloaded, "overloaded"],
      ["server error", errors.http.serverError, "overloaded"],
      ["bad request", errors.http.badRequest, "unexpected"],
      ["no network", "no-network", "network"],
    ] as const)("maps %s", (_, answer, kind) => failsWith("decisions", answer, kind));

    it("logs the failure", async () => {
      const { result, logger } = runPass("intent", errors.http.overloaded);
      await result;
      expect(logger.entries).toContainEqual(
        expect.objectContaining({
          level: "warn",
          fields: expect.objectContaining({ pass: "intent", kind: "overloaded" }),
        }),
      );
    });
  });

  describe("checkSize", () => {
    it("counts the intent pass's request, without the parameters counting doesn't take", async () => {
      const { model, requests } = modelWith(recorded());
      const result = await model.checkSize(smallFeatureInput);

      expect(result).toEqual({ ok: true, value: { inputTokens: 6431 } });
      const [request] = requests;
      expect(new URL(request?.url ?? "").pathname).toBe("/v1/messages/count_tokens");
      expect(request?.body).not.toHaveProperty("fallbacks");
      expect(request?.body).not.toHaveProperty("max_tokens");
      expect(request?.body.messages[2]?.content[0]?.text).toMatch(/^Task: intent\.$/m);
    });

    it("fails when the input is over the limit", async () => {
      const { model } = modelWith(recorded(), { maxInputTokens: 6000 });
      expect(await model.checkSize(smallFeatureInput)).toEqual({
        ok: false,
        error: {
          kind: "too-large",
          message: "The pull request is ~6431 tokens, over the limit of 6000.",
        },
      });
    });

    it("maps API errors", async () => {
      const { model } = modelWith({ countTokens: errors.http.unauthorized });
      const result = await model.checkSize(smallFeatureInput);
      expect(result.ok ? null : result.error.kind).toBe("unauthorized");
    });
  });
});
