import { describe, expect, it } from "vitest";
import { RecordingLogger } from "../../../application/testing/index.ts";
import type { ModelBilling, ModelErrorKind } from "../../../domain/review/index.ts";
import { suggestedDrafts, suggestionInput } from "../shared/fixtures/suggestion.ts";
import { SUGGEST_SYSTEM_PROMPT } from "../shared/prompts/suggest.ts";
import { SUGGESTION_ANSWER_FORMAT } from "../shared/suggestion.ts";
import { NOT_SIGNED_IN } from "./codex-errors.ts";
import { DISABLED_FEATURES, INSTRUCTIONS_FILE, SCHEMA_FILE } from "./codex-request.ts";
import { createCodexSuggester } from "./codex-suggester.ts";
import {
  createFakeRunCodex,
  type RecordedRun,
  recordedLines,
  syntheticLines,
} from "./fixtures/fake-run-codex.ts";
import type { CodexRun } from "./run-codex.ts";

/** Synthetic: the recorded intent session, its last message saying `text`. */
const sayingText = (text: string): string[] =>
  recordedLines("intent").map((line) =>
    line.includes("agent_message")
      ? JSON.stringify({
          type: "item.completed",
          item: { id: "item_1", type: "agent_message", text },
        })
      : line,
  );

const saying = (answer: unknown): string[] => sayingText(JSON.stringify(answer));

const suggesterWith = (
  answer: readonly string[] | Partial<CodexRun> = saying({ proposals: suggestedDrafts }),
  options: { billing?: ModelBilling; model?: string } = {},
) => {
  const fake = createFakeRunCodex(() => answer);
  const logger = new RecordingLogger();
  const suggester = createCodexSuggester({
    run: fake.run,
    billing: options.billing ?? "plan",
    model: options.model ?? "gpt-6-luna",
    efforts: ["low", "medium", "high", "xhigh", "max"],
    logger,
  });
  return { suggester, calls: fake.calls, logger };
};

const expectFailure = async (
  answer: readonly string[] | Partial<CodexRun>,
  kind: ModelErrorKind,
  message: string | RegExp,
) => {
  const setup = suggesterWith(answer);
  const result = await setup.suggester.suggest(suggestionInput);
  if (result.ok) throw new Error("expected the call to fail");
  expect(result.error.kind).toBe(kind);
  expect(result.error.message).toMatch(message);
  return setup;
};

const valueAfter = (args: readonly string[], flag: string) => args[args.indexOf(flag) + 1];

describe("CodexSuggester", () => {
  it("returns the proposals and what the call used, at API prices, billed to the plan", async () => {
    const result = await suggesterWith().suggester.suggest(suggestionInput);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual({
      value: suggestedDrafts,
      usage: {
        inputTokens: 8789,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 248,
        costUsd: expect.closeTo((8789 * 0.1 + 248 * 0.5) / 1_000_000, 8),
        billing: "plan",
      },
    });
  });

  it("reports no cost for a model without a known price", async () => {
    const { suggester } = suggesterWith(undefined, { model: "gpt-unpriced" });
    const result = await suggester.suggest(suggestionInput);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.usage.costUsd).toBeNull();
  });

  it("runs one locked-down call: its own instructions and schema, the history on stdin", async () => {
    const { suggester, calls } = suggesterWith();
    await suggester.suggest(suggestionInput);
    expect(calls).toHaveLength(1);
    const args = calls[0]?.args ?? [];
    expect(valueAfter(args, "--model")).toBe("gpt-6-luna");
    expect(valueAfter(args, "--sandbox")).toBe("read-only");
    expect(args).toContain("model_reasoning_effort=medium");
    for (const flag of ["--ephemeral", "--ignore-user-config", "--ignore-rules"]) {
      expect(args).toContain(flag);
    }
    const disabled = args.flatMap((arg, index) => (args[index - 1] === "--disable" ? [arg] : []));
    expect(disabled).toEqual([...DISABLED_FEATURES]);
    expect(calls[0]?.options.files).toEqual({
      [INSTRUCTIONS_FILE]: SUGGEST_SYSTEM_PROMPT,
      [SCHEMA_FILE]: JSON.stringify(SUGGESTION_ANSWER_FORMAT.schema),
    });
    expect(calls[0]?.options.stdin?.startsWith("<review_history>")).toBe(true);
    expect(calls[0]?.options.stdin).toMatch(/^Task: suggest\.$/m);
  });

  it.each<[RecordedRun, RegExp]>([
    ["command", /command_execution/],
    ["mcp-call", /mcp_tool_call/],
    ["agent-tool", /collab_tool_call/],
  ])(
    "kills a recorded session that used a tool (%s), and discards its answer",
    async (name, tool) => {
      const { calls } = await expectFailure(recordedLines(name), "unexpected", tool);
      expect(calls[0]?.result.killed).toBe("rejected");
      expect(calls[0]?.result.lines.join("\n")).not.toContain("agent_message");
    },
  );

  it("says the suggestion was stopped, not a pass", async () => {
    await expectFailure(
      recordedLines("command"),
      "unexpected",
      /so the suggestion was stopped and its answer discarded/,
    );
  });

  it("fails a pass's answer, or one that isn't JSON, as invalid output", async () => {
    await expectFailure(recordedLines("intent"), "invalid-output", /proposals/);
    await expectFailure(sayingText("Sure, here they are"), "invalid-output", /isn't JSON/);
  });

  it("says to sign in, from a recorded run signed out", async () => {
    await expectFailure(
      { lines: recordedLines("not-signed-in"), code: 1 },
      "unauthorized",
      NOT_SIGNED_IN,
    );
  });

  it("says the history is too long in its own words, and logs the failure", async () => {
    const { logger } = await expectFailure(
      { lines: syntheticLines("too-long"), code: 1 },
      "too-large",
      /^Your reviews are too long/,
    );
    expect(logger.entries).toContainEqual(
      expect.objectContaining({
        level: "warn",
        message: "Suggesting preferences failed",
        fields: expect.objectContaining({ transport: "codex", kind: "too-large" }),
      }),
    );
  });
});
