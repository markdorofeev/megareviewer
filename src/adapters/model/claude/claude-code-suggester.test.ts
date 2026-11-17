import { describe, expect, it } from "vitest";
import { RecordingLogger } from "../../../application/testing/index.ts";
import type { ModelBilling, ModelErrorKind } from "../../../domain/review/index.ts";
import { suggestedDrafts, suggestionInput } from "../shared/fixtures/suggestion.ts";
import { SUGGEST_SYSTEM_PROMPT } from "../shared/prompts/suggest.ts";
import { SUGGESTION_ANSWER_FORMAT } from "../shared/suggestion.ts";
import { NOT_SIGNED_IN } from "./claude-code-errors.ts";
import { SYSTEM_PROMPT_FILE } from "./claude-code-request.ts";
import { createClaudeCodeSuggester } from "./claude-code-suggester.ts";
import {
  createFakeRunClaude,
  recordedLines,
  type SyntheticRun,
  syntheticLines,
} from "./fixtures/fake-run-claude.ts";
import type { ClaudeRun } from "./run-claude.ts";

const suggesterWith = (
  answer: readonly string[] | Partial<ClaudeRun> = recordedLines("suggest"),
  options: { billing?: ModelBilling; managedMcpServers?: readonly string[] | null } = {},
) => {
  const fake = createFakeRunClaude(() => answer);
  const logger = new RecordingLogger();
  const suggester = createClaudeCodeSuggester({
    run: fake.run,
    billing: options.billing ?? "plan",
    // The fixture was recorded on Sonnet 5.5.
    model: "claude-sonnet-5-5",
    logger,
    // Not the machine's own managed-mcp.json.
    managedMcpServers: options.managedMcpServers ?? null,
  });
  return { suggester, calls: fake.calls, logger };
};

const flag = (args: readonly string[], name: string) => args[args.indexOf(name) + 1];

const expectFailure = async (
  answer: readonly string[] | Partial<ClaudeRun>,
  kind: ModelErrorKind,
  message: string | RegExp,
) => {
  const result = await suggesterWith(answer).suggester.suggest(suggestionInput);
  if (result.ok) throw new Error("expected the call to fail");
  expect(result.error.kind).toBe(kind);
  expect(result.error.message).toMatch(message);
};

describe("ClaudeCodeSuggester", () => {
  it("returns the proposals of a recorded call, and what it used on the plan", async () => {
    const result = await suggesterWith().suggester.suggest(suggestionInput);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual({
      value: suggestedDrafts,
      usage: {
        inputTokens: 2,
        cacheReadTokens: 0,
        cacheWriteTokens: 2999,
        outputTokens: 341,
        costUsd: expect.closeTo(0.0154, 4),
        billing: "plan",
      },
    });
  });

  it("runs one locked-down call: its own prompt and schema, no tools, medium effort", async () => {
    const { suggester, calls } = suggesterWith();
    await suggester.suggest(suggestionInput);
    expect(calls).toHaveLength(1);
    const args = calls[0]?.args ?? [];
    expect(flag(args, "--model")).toBe("claude-sonnet-5-5");
    expect(flag(args, "--effort")).toBe("medium");
    expect(flag(args, "--tools")).toBe("");
    expect(flag(args, "--setting-sources")).toBe("");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--no-session-persistence");
    expect(JSON.parse(flag(args, "--json-schema") ?? "")).toEqual(SUGGESTION_ANSWER_FORMAT.schema);
    expect(calls[0]?.options.files?.[SYSTEM_PROMPT_FILE]).toBe(SUGGEST_SYSTEM_PROMPT);
  });

  it("sends the reviewer's history on stdin, as data, and none of it in the system prompt", async () => {
    const { suggester, calls } = suggesterWith();
    await suggester.suggest(suggestionInput);
    const stdin = calls[0]?.options.stdin ?? "";
    expect(stdin.startsWith("<review_history>")).toBe(true);
    expect(stdin).toContain('pr="acme/api #12"');
    expect(stdin).toMatch(/^Task: suggest\.$/m);
    expect(stdin).toContain("loadPlugins");
    expect(calls[0]?.options.files?.[SYSTEM_PROMPT_FILE]).not.toContain("loadPlugins");
  });

  it("denies an organization's managed MCP servers by name", async () => {
    const { suggester, calls } = suggesterWith(recordedLines("suggest"), {
      managedMcpServers: ["github"],
    });
    await suggester.suggest(suggestionInput);
    const args = calls[0]?.args ?? [];
    expect(args).not.toContain("--strict-mcp-config");
    expect(flag(args, "--settings")).toContain('"serverName":"github"');
  });

  it("bills a Console sign-in to the API", async () => {
    const { suggester } = suggesterWith(recordedLines("suggest"), { billing: "api" });
    const result = await suggester.suggest(suggestionInput);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.usage.billing).toBe("api");
  });

  it.each<[SyntheticRun, RegExp]>([
    ["tools", /tools: Bash/],
    ["mcp-server", /MCP servers: github/],
    ["api-key", /would bill an API key/],
  ])(
    "stops a session with %s at its first event, before the model reads the history",
    async (name, problem) => {
      const { suggester, calls } = suggesterWith([
        ...syntheticLines(name),
        ...recordedLines("suggest").slice(1),
      ]);
      const result = await suggester.suggest(suggestionInput);
      expect(calls[0]?.result.killed).toBe("rejected");
      expect(calls[0]?.result.lines).toHaveLength(1);
      if (result.ok) throw new Error("expected the call to fail");
      expect(result.error.message).toMatch(problem);
      expect(result.error.message).toContain("so the suggestion was stopped");
    },
  );

  it("fails a pass's answer, or any answer outside the schema, as invalid output", async () => {
    await expectFailure(recordedLines("intent"), "invalid-output", /proposals/);
  });

  it("says to sign in, from a recorded run signed out", async () => {
    await expectFailure(recordedLines("not-signed-in"), "unauthorized", NOT_SIGNED_IN);
  });

  it("says the history is too long in its own words, and logs the failure", async () => {
    const { suggester, logger } = suggesterWith(syntheticLines("prompt-too-long"));
    const result = await suggester.suggest(suggestionInput);
    if (result.ok) throw new Error("expected the call to fail");
    expect(result.error).toEqual({
      kind: "too-large",
      message:
        "Your reviews are too long for the model's context window to suggest preferences from.",
    });
    expect(logger.entries).toContainEqual({
      level: "warn",
      message: "Suggesting preferences failed",
      fields: { transport: "claude-code", ...result.error },
    });
  });
});
