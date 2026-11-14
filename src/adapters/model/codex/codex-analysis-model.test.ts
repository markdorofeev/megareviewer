import { describe, expect, it } from "vitest";
import {
  describeAnalysisModelContract,
  RecordingLogger,
  smallFeatureInput,
  smallFeatureIntent,
} from "../../../application/testing/index.ts";
import type { ModelBilling, ModelErrorKind, ModelPass } from "../../../domain/review/index.ts";
import { createCodexAnalysisModel, OVERHEAD_TOKENS } from "./codex-analysis-model.ts";
import { NOT_INSTALLED, NOT_SIGNED_IN } from "./codex-errors.ts";
import { INSTRUCTIONS_FILE, SCHEMA_FILE } from "./codex-request.ts";
import {
  createFakeRunCodex,
  type RecordedRun,
  recordedLines,
  type SyntheticRun,
  syntheticLines,
} from "./fixtures/fake-run-codex.ts";
import type { CodexRun } from "./run-codex.ts";

const recorded = (pass: ModelPass | null) => recordedLines(pass ?? "intent");

const modelWith = (
  answer: Parameters<typeof createFakeRunCodex>[0] = recorded,
  options: { billing?: ModelBilling; model?: string; contextWindow?: number } = {},
) => {
  const fake = createFakeRunCodex(answer);
  const logger = new RecordingLogger();
  const model = createCodexAnalysisModel({
    run: fake.run,
    billing: options.billing ?? "plan",
    // The fixtures were recorded on GPT-6 Luna.
    model: options.model ?? "gpt-6-luna",
    efforts: ["low", "medium", "high", "xhigh", "max"],
    ...(options.contextWindow === undefined ? {} : { contextWindow: options.contextWindow }),
    logger,
  });
  return { model, calls: fake.calls, logger };
};

describeAnalysisModelContract("codex", () => modelWith().model);

const intentWith = async (answer: readonly string[] | Partial<CodexRun>) => {
  const setup = modelWith(() => answer);
  return { ...setup, result: await setup.model.intent(smallFeatureInput) };
};

const expectFailure = async (
  answer: readonly string[] | Partial<CodexRun>,
  kind: ModelErrorKind,
  message?: string | RegExp,
) => {
  const { result } = await intentWith(answer);
  if (result.ok) throw new Error("expected the pass to fail");
  expect(result.error.kind).toBe(kind);
  if (message !== undefined) expect(result.error.message).toMatch(message);
};

describe("CodexAnalysisModel", () => {
  it("has a version of its own that names the model", () => {
    expect(modelWith().model.version).toMatch(/^codex\/gpt-6-luna\/p\d+$/);
    expect(modelWith(recorded, { model: "gpt-6-sol" }).model.version).toMatch(
      /^codex\/gpt-6-sol\/p\d+$/,
    );
  });

  it("runs every pass with the same instructions and schema, the PR in the instructions", async () => {
    const { model, calls } = modelWith();
    await model.intent(smallFeatureInput);
    await model.risk(smallFeatureInput, smallFeatureIntent);
    await model.decisions(smallFeatureInput, smallFeatureIntent);
    expect(calls).toHaveLength(3);
    const instructions = calls.map((call) => call.options.files?.[INSTRUCTIONS_FILE]);
    expect(new Set(instructions).size).toBe(1);
    expect(instructions[0]).toContain("<pull_request_data>");
    expect(new Set(calls.map((call) => call.options.files?.[SCHEMA_FILE])).size).toBe(1);
    expect(calls[1]?.options.stdin).toMatch(/^Task: risk\./m);
    expect(calls[1]?.options.stdin).toContain("<earlier_results>");
    const efforts = calls.map((call) =>
      call.args.find((arg) => arg.startsWith("model_reasoning_effort=")),
    );
    expect(efforts).toEqual([
      "model_reasoning_effort=medium",
      "model_reasoning_effort=low",
      "model_reasoning_effort=high",
    ]);
  });

  it("reports what the pass used, at API prices, billed to the plan", async () => {
    const { result } = await intentWith(recordedLines("intent"));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.usage).toEqual({
      pass: "intent",
      inputTokens: 8789,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 248,
      costUsd: expect.closeTo((8789 * 0.1 + 248 * 0.5) / 1_000_000, 8),
      billing: "plan",
    });
  });

  it("reports no cost for a model without a known price", async () => {
    const setup = modelWith(recorded, { model: "gpt-unpriced" });
    const result = await setup.model.intent(smallFeatureInput);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.usage.costUsd).toBeNull();
  });

  it("fails an answer to another pass as invalid output", async () => {
    await expectFailure(recordedLines("risk"), "invalid-output", /answered the risk task/);
  });

  describe("lockdown", () => {
    it.each<[RecordedRun, RegExp]>([
      ["command", /command_execution \(\/bin\/zsh -lc 'curl/],
      ["mcp-call", /mcp_tool_call \(list_mcp_resources\)/],
      ["agent-tool", /collab_tool_call \(wait\)/],
    ])(
      "kills a recorded session that used a tool (%s) at the tool's first item",
      async (name, tool) => {
        const lines = recordedLines(name);
        const { result, calls } = await intentWith(lines);
        expect(calls[0]?.result.killed).toBe("rejected");
        const firstTool = lines.findIndex((line) => line.includes('"item.started"'));
        expect(calls[0]?.result.lines).toHaveLength(firstTool + 1);
        if (result.ok) throw new Error("expected the pass to fail");
        expect(result.error.kind).toBe("unexpected");
        expect(result.error.message).toMatch(/used a tool/);
        expect(result.error.message).toMatch(tool);
        expect(result.error.message).toMatch(/discarded/);
      },
    );

    it.each<SyntheticRun>(["file-change", "web-search", "unknown-item"])(
      "kills a session with a %s item before its answer",
      async (name) => {
        const { result, calls } = await intentWith(syntheticLines(name));
        expect(calls[0]?.result.killed).toBe("rejected");
        expect(calls[0]?.result.lines.join("\n")).not.toContain("agent_message");
        expect(result.ok).toBe(false);
      },
    );

    it("lets Codex's own error items and reasoning through", async () => {
      const reasoning = JSON.stringify({
        type: "item.completed",
        item: { id: "item_9", type: "reasoning", text: "Reading the hunks." },
      });
      const lines = recordedLines("intent");
      const { result } = await intentWith([...lines.slice(0, 3), reasoning, ...lines.slice(3)]);
      expect(result.ok).toBe(true);
    });
  });

  describe("errors", () => {
    it("says to install Codex when it can't be started", async () => {
      await expectFailure({ started: false, code: null }, "unauthorized", NOT_INSTALLED);
    });

    it.each<RecordedRun>(["not-signed-in", "api-key-rejected"])(
      "says to sign in, from a recorded run (%s)",
      async (name) => {
        await expectFailure({ lines: recordedLines(name), code: 1 }, "unauthorized", NOT_SIGNED_IN);
      },
    );

    it.each<[SyntheticRun, ModelErrorKind, RegExp]>([
      ["usage-limit", "rate-limited", /ChatGPT plan's usage limit is reached/],
      ["too-long", "too-large", /too long/],
      ["refusal", "refusal", /declined/],
    ])("maps %s", async (name, kind, message) => {
      await expectFailure({ lines: syntheticLines(name), code: 1 }, kind, message);
    });

    it("fails a turn that ended without an answer as invalid output", async () => {
      await expectFailure(syntheticLines("no-answer"), "invalid-output", /without an answer/);
    });

    it("fails an answer that isn't JSON as invalid output", async () => {
      const lines = recordedLines("intent").map((line) =>
        line.includes("agent_message")
          ? JSON.stringify({
              type: "item.completed",
              item: { id: "item_1", type: "agent_message", text: "Sure, here it is" },
            })
          : line,
      );
      await expectFailure(lines, "invalid-output", /isn't JSON/);
    });

    it("says when it ran too long", async () => {
      await expectFailure({ killed: "timeout", code: null }, "unexpected", /10 minutes/);
    });

    it("gives stderr's last line for anything else", async () => {
      await expectFailure(
        { code: 2, stderr: "warming up\nerror: unexpected argument '--ignore-rules'" },
        "unexpected",
        "Codex failed: error: unexpected argument '--ignore-rules'",
      );
    });
  });

  describe("size", () => {
    it("estimates the input from the prompt's bytes, without running Codex", async () => {
      const { model, calls } = modelWith();
      const size = await model.checkSize(smallFeatureInput);
      if (!size.ok) throw new Error(size.error.message);
      expect(size.value.inputTokens).toBeGreaterThan(OVERHEAD_TOKENS);
      expect(calls).toHaveLength(0);
    });

    it("errs high against the recorded count", async () => {
      const size = await modelWith().model.checkSize(smallFeatureInput);
      if (!size.ok) throw new Error(size.error.message);
      expect(size.value.inputTokens).toBeGreaterThanOrEqual(8789);
    });

    it("refuses a PR over the model's context window", async () => {
      const size = await modelWith(recorded, { contextWindow: 33_000 }).model.checkSize(
        smallFeatureInput,
      );
      if (size.ok) throw new Error("expected too-large");
      expect(size.error.kind).toBe("too-large");
    });
  });
});
