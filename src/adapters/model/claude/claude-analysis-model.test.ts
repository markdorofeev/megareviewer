import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  describeAnalysisModelContract,
  RecordingLogger,
  smallFeatureInput,
  smallFeatureIntent,
} from "../../../application/testing/index.ts";
import { type ModelErrorKind, ModelPass } from "../../../domain/review/index.ts";
import { GUIDANCE_BLOCK, withGuidance } from "../shared/fixtures/guidance.ts";
import { passSchema } from "../shared/prompted-answer.ts";
import { createClaudeAnalysisModel } from "./claude-analysis-model.ts";
import {
  createAnthropicFetch,
  type FixtureAnswer,
  type FixtureMessage,
  type RecordedRequest,
} from "./fixtures/anthropic-fetch.ts";
import errors from "./fixtures/errors.synthetic.json" with { type: "json" };
import readingRounds from "./fixtures/reading.json" with { type: "json" };
import smallFeature from "./fixtures/small-feature.synthetic.json" with { type: "json" };
import { costUsd, HIGHEST_PRICE, PRICES } from "./pricing.ts";
import { READ_FILE } from "./read-file.ts";
import { PROMPT_VERSION } from "./version.ts";

type Answers = Parameters<typeof createAnthropicFetch>[0];

const guidedInput = withGuidance(smallFeatureInput);

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
      : pass === "steps"
        ? model.steps(smallFeatureInput, options)
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

  it("returns the guidance a finding names, and null for one that names none", async () => {
    const { model } = modelWith(recorded());
    const findings = await model.findings(guidedInput, smallFeatureIntent);
    if (!findings.ok) throw new Error(findings.error.message);
    expect(findings.value.value.map((finding) => finding.guidance)).toEqual([
      { ref: "p1", effect: "raised" },
      null,
    ]);
  });

  it("sends the reviewer's guidance before the PR, in the cached block every pass shares", async () => {
    const { model, requests } = modelWith(recorded());
    await model.intent(guidedInput);
    await model.findings(guidedInput, smallFeatureIntent);
    const blocks = requests.map((request) => request.body.messages[0]?.content[0]?.text ?? "");
    expect(blocks[0]).toMatch(GUIDANCE_BLOCK);
    expect(blocks[0]?.startsWith("<reviewer_guidance>")).toBe(true);
    expect(blocks[1]).toBe(blocks[0]);
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
      await model.findings(smallFeatureInput, smallFeatureIntent);
      await model.steps(smallFeatureInput, { tour: true });
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
        ["medium", "high", "medium"].map((effort) => ({
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
      });
      expect(request?.headers.get("anthropic-beta")?.split(",")).toEqual([
        "mid-conversation-output-config-2026-07-01",
      ]);
    });

    it("sends no output format, since the API refuses the passes' union as too large a grammar", async () => {
      const requests = await runAllPasses();
      expect(requests.map((request) => request.body.output_config)).toEqual(
        Array(3).fill({ effort: "medium" }),
      );
      for (const request of requests) expect(request.body).not.toHaveProperty("output_format");
    });

    it("ends each pass's task with the schema of its own answer", async () => {
      const requests = await runAllPasses();
      for (const [index, pass] of ModelPass.options.entries()) {
        const task = requests[index]?.body.messages[2]?.content[0]?.text ?? "";
        expect(task).toMatch(/Answer with one JSON object and nothing else/);
        expect(task.endsWith(JSON.stringify(passSchema(pass)))).toBe(true);
      }
    });

    it("sends a run with the tour what it sends one without, and the steps pass its own schema", async () => {
      const { model, requests } = modelWith(recorded());
      await model.intent(smallFeatureInput);
      await model.intent(smallFeatureInput, { tour: true });
      const steps = await model.steps(smallFeatureInput, { tour: true });
      expect(steps.ok && steps.value.value.steps).toHaveLength(3);

      expect(requests[1]?.body).toEqual(requests[0]?.body);
      const { messages, ...shared } = requests[2]?.body ?? { messages: [] };
      expect(shared).toEqual({ ...requests[0]?.body, messages: undefined });
      expect(shared.output_config).toEqual({ effort: "medium" });
      expect(messages[0]).toEqual(requests[0]?.body.messages[0]);
      const task = messages[2]?.content[0]?.text ?? "";
      expect(task).toMatch(/^Task: steps\./);
      expect(task.endsWith(JSON.stringify(passSchema("steps")))).toBe(true);
    });

    it("asks each pass for its own task, and only the findings with the intent's answer", async () => {
      const requests = await runAllPasses();
      const instructions = requests.map(
        (request) => request.body.messages[2]?.content[0]?.text ?? "",
      );
      expect(instructions.map((text) => /^Task: (\w+)\./m.exec(text)?.[1])).toEqual([
        "intent",
        "findings",
        "steps",
      ]);
      expect(instructions.map((text) => text.includes("<earlier_results>"))).toEqual([
        false,
        true,
        false,
      ]);
    });

    it("appends the feedback on the previous answer when given", async () => {
      const instruction = async (feedback?: readonly string[]) => {
        const { result, requests } = runPass("findings", smallFeature.passes.findings, feedback);
        await result;
        return requests[0]?.body.messages[2]?.content[0]?.text ?? "";
      };
      expect(await instruction(["h_1 is not a hunk", "h_2 missing"])).toMatch(
        /\n\nYour previous answer had these problems: h_1 is not a hunk; h_2 missing\. Fix them\.\n\nAnswer with one JSON object/,
      );
      expect(await instruction()).toMatch(/^Task: findings\.$/m);
      expect(await instruction()).not.toContain("previous answer");
    });
  });

  describe("usage", () => {
    it("reports tokens and cost per pass", async () => {
      const { result, logger } = runPass("findings", smallFeature.passes.findings);
      const output = await result;
      if (!output.ok) throw new Error(output.error.message);

      const tokens = {
        inputTokens: 244,
        cacheReadTokens: 6012,
        cacheWriteTokens: 0,
        outputTokens: 688,
      };
      const price = PRICES["claude-haiku-5-5"];
      if (price === undefined) throw new Error("no price for the model");
      expect(output.value.usage).toEqual({
        pass: "findings",
        ...tokens,
        costUsd: costUsd(price, tokens),
        billing: "api",
      });
      expect(logger.entries).toContainEqual(
        expect.objectContaining({
          level: "info",
          fields: expect.objectContaining({ pass: "findings", model: "claude-haiku-5-5" }),
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
      failsWith("findings", errors.messages.maxTokens, "max-tokens", /64000/));

    it("reports an answer that isn't JSON", () =>
      failsWith("intent", errors.messages.malformed, "invalid-output", /isn't one JSON object/));

    it("reads an answer wrapped in a code fence or a sentence, which nothing but the prompt forbids", async () => {
      const [thinking, answer] = smallFeature.passes.intent.content;
      if (thinking === undefined || answer?.text === undefined) throw new Error("no answer");
      for (const text of [`\`\`\`json\n${answer.text}\n\`\`\``, `Here it is:\n${answer.text}`]) {
        const message = { ...smallFeature.passes.intent, content: [thinking, { ...answer, text }] };
        expect((await runPass("intent", message).result).ok).toBe(true);
      }
    });

    it("reports an answer outside the schema", () =>
      failsWith("findings", errors.messages.outsideSchema, "invalid-output", /severity/));

    it("reports an answer to another pass", () =>
      failsWith(
        "findings",
        errors.messages.wrongPass,
        "invalid-output",
        /intent task instead of findings/,
      ));

    it.each([
      ["unauthorized", errors.http.unauthorized, "unauthorized"],
      ["forbidden", errors.http.forbidden, "unauthorized"],
      ["rate-limited", errors.http.rateLimited, "rate-limited"],
      ["overloaded", errors.http.overloaded, "overloaded"],
      ["server error", errors.http.serverError, "overloaded"],
      ["bad request", errors.http.badRequest, "unexpected"],
      ["no network", "no-network", "network"],
    ] as const)("maps %s", (_, answer, kind) => failsWith("findings", answer, kind));

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

  describe("with a harness to read", () => {
    const RULES = "harness/docs/rules.md";
    const PLAN = "harness/docs/plan.md";
    const harness = {
      files: [RULES, PLAN].map((path, index) => ({
        ref: `g${index + 1}`,
        path,
        bytes: 20,
        lines: 3,
        linkedFrom: "CLAUDE.md",
        headings: [],
      })),
      contents: new Map([
        [RULES, "# Rules\n\nNo raw SQL."],
        [PLAN, "# Plan\n\nShip it."],
      ]),
    };
    const reading = { ...smallFeatureInput, harness };

    const usage = {
      input_tokens: 300,
      cache_read_input_tokens: 6000,
      cache_creation_input_tokens: 100,
      output_tokens: 40,
    };
    /** The model asking for files, after thinking, as a round of reading starts. */
    const asks = (...inputs: readonly unknown[]): FixtureMessage => ({
      ...smallFeature.passes.findings,
      content: [
        { type: "thinking", thinking: "", signature: "c2lnbmF0dXJl" },
        { type: "text", text: "Reading the rules {first}." },
        ...inputs.map((input, index) => ({
          type: "tool_use",
          id: `toolu_${index + 1}`,
          name: READ_FILE.name,
          input,
        })),
      ],
      stop_reason: "tool_use",
      usage,
    });

    const findingsWith = async (
      answers: readonly FixtureAnswer[],
      options?: Parameters<ReturnType<typeof modelWith>["model"]["findings"]>[2],
    ) => {
      const setup = modelWith({ passes: { findings: answers } });
      return {
        ...setup,
        result: await setup.model.findings(reading, smallFeatureIntent, options),
      };
    };

    const resultsIn = (request: RecordedRequest | undefined) =>
      request?.body.messages.at(-1)?.content ?? [];
    const breakpoints = (request: RecordedRequest): number =>
      JSON.stringify(request.body).split('"cache_control"').length - 1;

    it("says it reads", () => {
      expect(modelWith({}).model.readsHarness).toBe(true);
    });

    it("reads through recorded rounds: one file, two in parallel, then the answer", async () => {
      const { model, requests } = modelWith(readingRounds);
      const first = "harness/docs/where-rules-are.md";
      const second = ["harness/docs/rules/03.md", "harness/docs/rules/04.md"];
      const contents = new Map([first, ...second].map((path) => [path, `# ${path}\n`]));
      const result = await model.intent({
        ...smallFeatureInput,
        harness: { files: harness.files, contents },
      });
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.reads?.map(({ path, outcome }) => [path, outcome])).toEqual(
        [first, ...second].map((path) => [path, "read"]),
      );
      expect(requests).toHaveLength(3);
      expect(resultsIn(requests[1]).map(({ content }) => content)).toEqual([`# ${first}`]);
      expect(resultsIn(requests[2]).map(({ content }) => content)).toEqual(
        second.map((path) => `# ${path}`),
      );
      // Sent back as the API gave it: the thinking with its signature, then what it asked for.
      expect(requests[2]?.body.messages.at(-2)?.content).toEqual([
        { type: "thinking", thinking: "", signature: expect.any(String) },
        ...second.map((path) =>
          expect.objectContaining({ type: "tool_use", name: "read_file", input: { path } }),
        ),
      ]);
      expect(result.value.usage).toMatchObject({
        inputTokens: 1566,
        cacheReadTokens: 13_203,
        cacheWriteTokens: 10_036,
      });
    });

    it("serves one read, then takes the answer, with what was read", async () => {
      const { result, requests } = await findingsWith([
        asks({ path: RULES }),
        smallFeature.passes.findings,
      ]);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.value).toHaveLength(2);
      expect(result.value.reads).toEqual([
        { path: RULES, fromLine: null, toLine: null, outcome: "read" },
      ]);

      const [first, second] = requests.map(({ body }) => body);
      expect(requests).toHaveLength(2);
      expect({ ...second, messages: [] }).toEqual({ ...first, messages: [] });
      expect(second?.messages.slice(0, 3)).toEqual(first?.messages);
      expect(second?.messages.slice(3)).toEqual([
        { role: "assistant", content: asks({ path: RULES }).content },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_1",
              content: "# Rules\n\nNo raw SQL.",
              cache_control: { type: "ephemeral" },
            },
          ],
        },
      ]);
    });

    it("takes only the last round's text as the answer", async () => {
      const { result } = await findingsWith([asks({ path: RULES }), errors.messages.malformed]);
      if (result.ok) throw new Error("expected no answer");
      expect(result.error.kind).toBe("invalid-output");
      expect(result.error.reads).toHaveLength(1);
    });

    it("answers a round's parallel reads in one message, the last of them cached", async () => {
      const { result, requests } = await findingsWith([
        asks({ path: RULES }, { path: PLAN, first_line: 3, last_line: 3 }, { path: "/etc/hosts" }),
        smallFeature.passes.findings,
      ]);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.reads).toEqual([
        { path: RULES, fromLine: null, toLine: null, outcome: "read" },
        { path: PLAN, fromLine: 3, toLine: 3, outcome: "read" },
        { path: "/etc/hosts", fromLine: null, toLine: null, outcome: "refused" },
      ]);
      const results = resultsIn(requests[1]);
      expect(results.map((block) => [block.tool_use_id, block.content, block.is_error])).toEqual([
        ["toolu_1", "# Rules\n\nNo raw SQL.", undefined],
        ["toolu_2", "Ship it.", undefined],
        ["toolu_3", "/etc/hosts isn't one of the files to read.", true],
      ]);
      expect(results.map((block) => "cache_control" in block)).toEqual([false, false, true]);
    });

    it("goes on after a refused path, recorded as refused", async () => {
      const { result, requests } = await findingsWith([
        asks({ path: "../../.ssh/id_rsa" }),
        smallFeature.passes.findings,
      ]);
      expect(result.ok && result.value.reads).toEqual([
        { path: "../../.ssh/id_rsa", fromLine: null, toLine: null, outcome: "refused" },
      ]);
      expect(resultsIn(requests[1])[0]).toMatchObject({ is_error: true });
    });

    const reads = (times: number) => Array.from({ length: times }, () => asks({ path: RULES }));

    it("reads for eight rounds and answers on the next", async () => {
      const { result, requests } = await findingsWith([...reads(8), smallFeature.passes.findings]);
      expect(result.ok && result.value.reads).toHaveLength(8);
      expect(requests).toHaveLength(9);
    });

    it("never sends more than the API's four breakpoints: the PR's and the latest rounds'", async () => {
      const { requests } = await findingsWith([...reads(8), smallFeature.passes.findings]);
      expect(requests.map(breakpoints)).toEqual([1, 2, 3, 4, 4, 4, 4, 4, 4]);
      for (const request of requests) {
        expect(request.body.messages[0]?.content[0]).toHaveProperty("cache_control");
        if (request !== requests[0]) {
          expect(resultsIn(request).at(-1)).toHaveProperty("cache_control");
        }
      }
    });

    it("fails as a reader's when the rounds run out, with what it read", async () => {
      const { result, requests } = await findingsWith(reads(9));
      if (result.ok) throw new Error("expected the rounds to run out");
      expect(result.error).toMatchObject({
        kind: "reader",
        message: "It used up its rounds of reading before it answered.",
      });
      expect(result.error.reads).toHaveLength(8);
      expect(requests).toHaveLength(9);
    });

    it("fails as a reader's when the API refuses the request with what it read", async () => {
      const { result } = await findingsWith([asks({ path: RULES }), errors.http.badRequest]);
      if (result.ok) throw new Error("expected the request to be refused");
      expect(result.error.kind).toBe("reader");
      expect(result.error.message).toMatch(/^The API refused what it read: Anthropic answered 400/);
      expect(result.error.reads).toHaveLength(1);
    });

    it("fails as a reader's when what it read fills the context window", async () => {
      const { result } = await findingsWith([
        asks({ path: RULES }),
        { ...smallFeature.passes.findings, stop_reason: "model_context_window_exceeded" },
      ]);
      expect(result.ok ? null : result.error.kind).toBe("reader");
    });

    it.each([
      ["refusal", errors.messages.refusal, "refusal"],
      ["cut off", errors.messages.maxTokens, "max-tokens"],
      ["rate limit", errors.http.rateLimited, "rate-limited"],
      ["no network", "no-network", "network"],
    ] as const)(
      "keeps a later round's own failure, a %s, with what it read",
      async (_, answer, kind) => {
        const { result } = await findingsWith([asks({ path: RULES }), answer]);
        if (result.ok) throw new Error("expected the pass to fail");
        expect(result.error.kind).toBe(kind);
        expect(result.error.reads).toHaveLength(1);
      },
    );

    it("says once that the answer has begun, on the first round", async () => {
      let answering = 0;
      await findingsWith([...reads(2), smallFeature.passes.findings], {
        onAnswering: () => {
          answering += 1;
        },
      });
      expect(answering).toBe(1);
    });

    it("adds up the rounds' usage, each priced on its own", async () => {
      const long = { ...asks({ path: RULES }), usage: { ...usage, input_tokens: 100_000 } };
      const { result, logger } = await findingsWith([long, smallFeature.passes.findings]);
      if (!result.ok) throw new Error(result.error.message);
      const price = PRICES["claude-haiku-5-5"];
      if (price === undefined) throw new Error("no price for the model");
      const first = {
        inputTokens: 100_000,
        cacheReadTokens: 6000,
        cacheWriteTokens: 100,
        outputTokens: 40,
      };
      const last = {
        inputTokens: 244,
        cacheReadTokens: 6012,
        cacheWriteTokens: 0,
        outputTokens: 688,
      };
      expect(result.value.usage).toEqual({
        pass: "findings",
        inputTokens: 100_244,
        cacheReadTokens: 12_012,
        cacheWriteTokens: 100,
        outputTokens: 728,
        costUsd: costUsd(price, first) + costUsd(price, last),
        billing: "api",
      });
      expect(
        logger.entries
          .filter((entry) => entry.message === "Model round finished")
          .map((entry) => entry.fields),
      ).toEqual([
        expect.objectContaining({ pass: "findings", round: 1, ...first }),
        expect.objectContaining({ pass: "findings", round: 2, ...last }),
      ]);
    });

    it("sends every pass the same tool before the same PR, the steps pass too", async () => {
      const { model, requests } = modelWith(recorded());
      await model.intent(reading);
      await model.findings(reading, smallFeatureIntent);
      await model.steps(reading, { tour: true });
      expect(requests).toHaveLength(3);
      const prefix = ({ body }: RecordedRequest) => {
        const { messages, ...settings } = body;
        return JSON.stringify([settings, messages[0]]);
      };
      expect(requests[0]?.body.tools).toEqual([READ_FILE]);
      for (const request of requests) {
        expect(prefix(request)).toBe(prefix(requests[0] ?? request));
      }
      for (const request of requests.slice(1)) {
        const task = request.body.messages[2]?.content[0]?.text ?? "";
        expect(task.split("First go through <readable_files>")).toHaveLength(2);
        expect(task.indexOf("First go through")).toBeGreaterThan(task.indexOf("Task: "));
        expect(task.indexOf("First go through")).toBeLessThan(task.indexOf("Answer with one JSON"));
      }
    });

    it("sends what a run without a harness does when run without the reader", async () => {
      const { model, requests } = modelWith(recorded());
      const result = await model.intent(reading, { withoutReader: true });
      await model.intent(smallFeatureInput);
      expect(result.ok && result.value.reads).toBeUndefined();
      expect(requests[0]?.body).toEqual(requests[1]?.body);
      expect(requests[0]?.body).not.toHaveProperty("tools");
    });

    it("counts the tool with the request, and no tool without a harness", async () => {
      const { model, requests } = modelWith(recorded());
      await model.checkSize(reading);
      await model.checkSize(smallFeatureInput);
      expect(requests[0]?.body.tools).toEqual([READ_FILE]);
      expect(requests[0]?.body.messages[0]?.content[0]?.text).toContain("<readable_files>");
      expect(requests[1]?.body).not.toHaveProperty("tools");
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
