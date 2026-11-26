import { describe, expect, it } from "vitest";
import {
  describeAnalysisModelContract,
  RecordingLogger,
  smallFeatureInput,
  smallFeatureIntent,
} from "../../../application/testing/index.ts";
import type { ModelBilling, ModelErrorKind, ModelPass } from "../../../domain/review/index.ts";
import type { Effort } from "../shared/effort.ts";
import { GUIDANCE_BLOCK, withGuidance } from "../shared/fixtures/guidance.ts";
import { createClaudeCodeAnalysisModel, OVERHEAD_TOKENS } from "./claude-code-analysis-model.ts";
import { NOT_INSTALLED, NOT_SIGNED_IN } from "./claude-code-errors.ts";
import { SYSTEM_PROMPT_FILE } from "./claude-code-request.ts";
import {
  createFakeRunClaude,
  recordedLines,
  type SyntheticRun,
  syntheticLines,
} from "./fixtures/fake-run-claude.ts";
import type { ClaudeRun } from "./run-claude.ts";
import { CLAUDE_CODE_VERSION } from "./version.ts";

const recorded = (pass: ModelPass | null) => recordedLines(pass ?? "intent");

const guidedInput = withGuidance(smallFeatureInput);

const modelWith = (
  answer: Parameters<typeof createFakeRunClaude>[0] = recorded,
  options: {
    billing?: ModelBilling;
    maxInputTokens?: number;
    model?: string;
    effort?: Effort;
    managedMcpServers?: readonly string[] | null;
  } = {},
) => {
  const fake = createFakeRunClaude(answer);
  const logger = new RecordingLogger();
  const model = createClaudeCodeAnalysisModel({
    run: fake.run,
    billing: options.billing ?? "plan",
    logger,
    ...(options.maxInputTokens === undefined ? {} : { maxInputTokens: options.maxInputTokens }),
    // The fixtures were recorded on Haiku 5.5.
    model: options.model ?? "claude-haiku-5-5",
    ...(options.effort === undefined ? {} : { effort: options.effort }),
    // Not the machine's own managed-mcp.json.
    managedMcpServers: options.managedMcpServers ?? null,
  });
  return { model, calls: fake.calls, logger };
};

describeAnalysisModelContract("claude code", () => modelWith().model);

const intentWith = async (
  answer: readonly string[] | Partial<ClaudeRun>,
  billing: ModelBilling = "plan",
) => {
  const setup = modelWith(() => answer, { billing });
  return { ...setup, result: await setup.model.intent(smallFeatureInput) };
};

const expectFailure = async (
  answer: readonly string[] | Partial<ClaudeRun>,
  kind: ModelErrorKind,
  message?: string | RegExp,
) => {
  const { result } = await intentWith(answer);
  if (result.ok) throw new Error("expected the pass to fail");
  expect(result.error.kind).toBe(kind);
  if (message !== undefined) expect(result.error.message).toMatch(message);
};

describe("ClaudeCodeAnalysisModel", () => {
  it("has a version of its own, so the API's analyses aren't served for it", () => {
    expect(modelWith().model.version).toMatch(/^claude-code\/claude-haiku-5-5\/p\d+$/);
    expect(CLAUDE_CODE_VERSION).toMatch(/^claude-code\/claude-sonnet-5-5\/p\d+$/);
  });

  it("runs another model when asked, with a version that names it", async () => {
    const { model, calls } = modelWith(recorded, { model: "claude-sonnet-5-5" });
    expect(model.version).toMatch(/^claude-code\/claude-sonnet-5-5\/p\d+$/);
    await model.intent(smallFeatureInput);
    const args = calls[0]?.args ?? [];
    expect(args[args.indexOf("--model") + 1]).toBe("claude-sonnet-5-5");
  });

  it("runs every pass at one effort when asked, and names it in the version", async () => {
    const { model, calls } = modelWith(recorded, { effort: "medium" });
    expect(model.version).toMatch(/^claude-code\/claude-haiku-5-5@medium\/p\d+$/);
    await model.intent(smallFeatureInput);
    await model.decisions(smallFeatureInput);
    const efforts = calls.map((call) => call.args[call.args.indexOf("--effort") + 1]);
    expect(efforts).toEqual(["medium", "medium"]);
  });

  it("warns when Claude Code answers on another model than the one asked for", async () => {
    const asked = modelWith(recorded, { model: "claude-sonnet-5-5" });
    await asked.model.intent(smallFeatureInput);
    expect(asked.logger.entries).toContainEqual({
      level: "warn",
      message: "Model pass answered by another model",
      fields: { pass: "intent", model: "claude-sonnet-5-5", served: ["claude-haiku-5-5"] },
    });

    const usual = modelWith();
    await usual.model.intent(smallFeatureInput);
    expect(usual.logger.entries.filter((entry) => entry.level === "warn")).toEqual([]);
  });

  it("says once that the answer has begun, when the model's first message comes", async () => {
    let answering = 0;
    const result = await modelWith().model.intent(smallFeatureInput, {
      onAnswering: () => {
        answering += 1;
      },
    });
    expect(result.ok).toBe(true);
    expect(answering).toBe(1);
  });

  it("runs every pass with the same system prompt file, which holds the PR data", async () => {
    const { model, calls } = modelWith();
    await model.intent(smallFeatureInput);
    await model.risk(smallFeatureInput);
    await model.decisions(smallFeatureInput);
    expect(calls).toHaveLength(3);
    const prompts = calls.map((call) => call.options.files?.[SYSTEM_PROMPT_FILE]);
    expect(new Set(prompts).size).toBe(1);
    expect(prompts[0]).toContain("<pull_request_data>");
    expect(calls[1]?.options.stdin).toMatch(/^Task: risk\./m);
    expect(calls[1]?.options.stdin).not.toContain("<earlier_results>");
  });

  it("puts the reviewer's guidance in that file, before the PR, the same for every pass", async () => {
    const { model, calls } = modelWith();
    await model.intent(guidedInput);
    await model.findings(guidedInput, smallFeatureIntent);
    const prompts = calls.map((call) => call.options.files?.[SYSTEM_PROMPT_FILE] ?? "");
    expect(prompts[0]).toMatch(GUIDANCE_BLOCK);
    expect(prompts[0]).toContain("</reviewer_guidance>\n<pull_request_data>\n<pull_request>");
    expect(prompts[1]).toBe(prompts[0]);
  });

  it("returns the guidance a finding names, and null for one that names none", async () => {
    const result = await modelWith().model.findings(guidedInput, smallFeatureIntent);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.value.map((finding) => finding.guidance)).toEqual([
      { ref: "p1", effect: "raised" },
      null,
    ]);
  });

  it("reads a risk recorded before there was guidance as having none", async () => {
    const result = await modelWith().model.risk(smallFeatureInput);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.value.length).toBeGreaterThan(0);
    expect(result.value.value.every((risk) => risk.guidance === null)).toBe(true);
  });

  it("reports what the pass used, at API prices, billed to the plan", async () => {
    const { result } = await intentWith(recordedLines("intent"));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.usage).toEqual({
      pass: "intent",
      inputTokens: 2,
      cacheReadTokens: 6242,
      cacheWriteTokens: 367,
      outputTokens: 2574,
      costUsd: expect.closeTo(0.0014, 4),
      billing: "plan",
    });
  });

  it("bills a Console sign-in to the API", async () => {
    const { result } = await intentWith(recordedLines("intent"), "api");
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.usage.billing).toBe("api");
  });

  it("fails an answer to another pass as invalid output", async () => {
    await expectFailure(recordedLines("risk"), "invalid-output", /answered the risk task/);
  });

  describe("with a harness to read", () => {
    const harness = {
      files: [
        {
          ref: "g1",
          path: "harness/docs/rules.md",
          bytes: 8,
          lines: 1,
          linkedFrom: "CLAUDE.md",
          headings: [],
        },
      ],
      contents: new Map([["harness/docs/rules.md", "# Rules\n"]]),
    };
    const reading = { ...smallFeatureInput, harness };
    const withReads = [...recordedLines("reads").slice(0, -1), ...recorded("intent").slice(1)];

    it("reads the harness, and says what it read with its answer", async () => {
      const { model, calls } = modelWith(() => withReads);
      expect(model.readsHarness).toBe(true);
      const result = await model.intent(reading);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.reads?.[0]).toMatchObject({ path: "harness/CLAUDE.md" });
      const [made] = calls;
      expect(made?.options.files?.["work/harness/docs/rules.md"]).toBe("# Rules\n");
      expect(made?.options.files?.[SYSTEM_PROMPT_FILE]).toContain("<readable_files>");
      expect(made?.options.stdin).not.toContain("First go through <readable_files>");
      await model.decisions(reading);
      expect(calls[1]?.options.stdin).toContain("First go through <readable_files>");
    });

    it("sends what a run without a harness does when run without the reader", async () => {
      const { model, calls } = modelWith();
      const result = await model.intent(reading, { withoutReader: true });
      await model.intent(smallFeatureInput);
      expect(result.ok && result.value.reads).toBeUndefined();
      expect(calls[0]?.args).toEqual(calls[1]?.args);
      expect(calls[0]?.options.files).toEqual(calls[1]?.options.files);
      expect(calls[0]?.options.stdin).toBe(calls[1]?.options.stdin);
    });

    it("says what a pass whose answer doesn't parse had read", async () => {
      const { model } = modelWith(() => [
        ...recordedLines("reads").slice(0, -1),
        ...recorded("risk").slice(1),
      ]);
      const result = await model.intent(reading);
      if (result.ok) throw new Error("expected the wrong pass's answer to fail");
      expect(result.error.kind).toBe("invalid-output");
      expect(result.error.reads?.[0]).toMatchObject({ path: "harness/CLAUDE.md" });
    });
  });

  describe("lockdown", () => {
    it.each<[SyntheticRun, RegExp]>([
      ["tools", /tools: Bash/],
      ["mcp-server", /MCP servers: github/],
      ["api-key", /would bill an API key \(ANTHROPIC_API_KEY\)/],
    ])("stops a session with %s at its first event", async (name, problem) => {
      const { result, calls } = await intentWith([
        ...syntheticLines(name),
        ...recordedLines("intent").slice(1),
      ]);
      expect(calls[0]?.result.killed).toBe("rejected");
      expect(calls[0]?.result.lines).toHaveLength(1);
      if (result.ok) throw new Error("expected the pass to fail");
      expect(result.error.kind).toBe("unexpected");
      expect(result.error.message).toMatch(problem);
    });

    it("lets a Console sign-in use its API key", async () => {
      const { result } = await intentWith(
        [...syntheticLines("api-key"), ...recordedLines("intent").slice(1)],
        "api",
      );
      expect(result.ok).toBe(true);
    });

    it("fails an answer that came without the session's first event", async () => {
      await expectFailure(recordedLines("intent").slice(1), "unexpected", /no session/);
    });
  });

  describe("errors", () => {
    it("says to install Claude Code when it can't be started", async () => {
      await expectFailure({ started: false, code: null }, "unauthorized", NOT_INSTALLED);
    });

    it("says to sign in, from a recorded run signed out", async () => {
      await expectFailure(recordedLines("not-signed-in"), "unauthorized", NOT_SIGNED_IN);
    });

    it.each<[SyntheticRun, ModelErrorKind, RegExp]>([
      ["rate-limited", "rate-limited", /usage limit is reached\. It resets at/],
      ["overloaded", "overloaded", /529 Overloaded/],
      ["prompt-too-long", "too-large", /too long/],
      ["network", "network", /Connection error/],
      ["refusal", "refusal", /declined/],
      ["max-turns", "invalid-output", /ran out of turns/],
    ])("maps %s", async (name, kind, message) => {
      await expectFailure(syntheticLines(name), kind, message);
    });

    it("says when it ran too long", async () => {
      await expectFailure({ killed: "timeout", code: null }, "unexpected", /10 minutes/);
    });

    it("explains an enterprise MCP config it couldn't read", async () => {
      await expectFailure(
        {
          code: 1,
          stderr: "You cannot use --strict-mcp-config when an enterprise MCP config is present",
        },
        "unexpected",
        /managed-mcp\.json is present/,
      );
    });

    it("gives stderr's last line for anything else", async () => {
      await expectFailure(
        { code: 2, stderr: "warming up\nerror: unknown option '--effort'" },
        "unexpected",
        "Claude Code failed: error: unknown option '--effort'",
      );
    });
  });

  describe("MCP servers", () => {
    it("asks for none with --strict-mcp-config without a managed config", async () => {
      const { model, calls } = modelWith();
      await model.intent(smallFeatureInput);
      expect(calls[0]?.args).toContain("--strict-mcp-config");
      expect(calls[0]?.args).not.toContain("--settings");
    });

    it("denies the managed config's servers instead, since Claude Code refuses the flag with one", async () => {
      const { model, calls } = modelWith(recorded, { managedMcpServers: ["github", "internal"] });
      const result = await model.intent(smallFeatureInput);
      if (!result.ok) throw new Error(result.error.message);
      const args = calls[0]?.args ?? [];
      expect(args).not.toContain("--strict-mcp-config");
      expect(JSON.parse(args[args.indexOf("--settings") + 1] ?? "")).toEqual({
        deniedMcpServers: [
          { serverName: "github" },
          { serverName: "internal" },
          { serverUrl: "*" },
        ],
      });
    });
  });

  describe("size", () => {
    it("estimates the input from the prompt's bytes, without running Claude Code", async () => {
      const { model, calls } = modelWith();
      const size = await model.checkSize(smallFeatureInput);
      if (!size.ok) throw new Error(size.error.message);
      expect(size.value.inputTokens).toBeGreaterThan(OVERHEAD_TOKENS);
      expect(calls).toHaveLength(0);
    });

    it("errs high against the recorded count", async () => {
      // The recorded intent pass read and wrote 6,611 tokens in all, the schema's tool included.
      const size = await modelWith().model.checkSize(smallFeatureInput);
      if (!size.ok) throw new Error(size.error.message);
      expect(size.value.inputTokens).toBeGreaterThanOrEqual(2 + 6242 + 367);
    });

    it("refuses a PR over the budget", async () => {
      const size = await modelWith(recorded, { maxInputTokens: 1_000 }).model.checkSize(
        smallFeatureInput,
      );
      if (size.ok) throw new Error("expected too-large");
      expect(size.error.kind).toBe("too-large");
    });
  });
});
