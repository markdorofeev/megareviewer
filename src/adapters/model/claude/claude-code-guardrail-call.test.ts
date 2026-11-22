import { describe, expect, it } from "vitest";
import { RecordingLogger } from "../../../application/testing/index.ts";
import { guardrailAnswer, guardrailInput } from "../shared/fixtures/guardrail-call.ts";
import { GUARDRAIL_ANSWER_FORMAT } from "../shared/guardrail-call.ts";
import { GUARDRAILS_SYSTEM_PROMPT } from "../shared/prompts/guardrails.ts";
import { createClaudeCodeAdvisor } from "./claude-code-one-call.ts";
import { SYSTEM_PROMPT_FILE } from "./claude-code-request.ts";
import { createFakeRunClaude, recordedLines, syntheticLines } from "./fixtures/fake-run-claude.ts";
import type { ClaudeRun } from "./run-claude.ts";

/** Synthetic: the recorded suggestion call, its structured answer replaced with `answer`. */
const answering = (answer: unknown): string[] =>
  recordedLines("suggest").map((line) => {
    const event = JSON.parse(line);
    if (event.type === "assistant") {
      const [tool] = event.message.content;
      return JSON.stringify({
        ...event,
        message: { ...event.message, content: [{ ...tool, input: answer }] },
      });
    }
    if (event.type === "result") {
      return JSON.stringify({
        ...event,
        result: JSON.stringify(answer),
        structured_output: answer,
      });
    }
    return line;
  });

const flag = (args: readonly string[], name: string) => args[args.indexOf(name) + 1];

const advisorWith = (
  answer: readonly string[] | Partial<ClaudeRun> = answering(guardrailAnswer),
) => {
  const fake = createFakeRunClaude(() => answer);
  const logger = new RecordingLogger();
  const advisor = createClaudeCodeAdvisor({
    run: fake.run,
    billing: "plan",
    model: "claude-sonnet-5-5",
    logger,
    managedMcpServers: null,
  });
  return { advisor, calls: fake.calls, logger };
};

describe("ClaudeCodeAdvisor's guardrail call", () => {
  it("returns the marks and what the call used on the plan", async () => {
    const result = await advisorWith().advisor.advise(guardrailInput);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.value).toEqual(guardrailAnswer);
    expect(result.value.usage).toMatchObject({ billing: "plan", cacheWriteTokens: 2999 });
  });

  it("runs one locked-down call: its own prompt and schema, no tools, medium effort, the data on stdin", async () => {
    const { advisor, calls } = advisorWith();
    await advisor.advise(guardrailInput);
    expect(calls).toHaveLength(1);
    const args = calls[0]?.args ?? [];
    expect(flag(args, "--effort")).toBe("medium");
    expect(flag(args, "--tools")).toBe("");
    expect(args).toContain("--strict-mcp-config");
    expect(JSON.parse(flag(args, "--json-schema") ?? "")).toEqual(GUARDRAIL_ANSWER_FORMAT.schema);
    expect(calls[0]?.options.files?.[SYSTEM_PROMPT_FILE]).toBe(GUARDRAILS_SYSTEM_PROMPT);
    const stdin = calls[0]?.options.stdin ?? "";
    expect(stdin.startsWith("<guardrail_data>")).toBe(true);
    expect(stdin).toMatch(/^Task: guardrails\.$/m);
  });

  it("stops a session with tools at its first event, in the call's words", async () => {
    const { advisor, calls } = advisorWith([
      ...syntheticLines("tools"),
      ...answering(guardrailAnswer).slice(1),
    ]);
    const result = await advisor.advise(guardrailInput);
    expect(calls[0]?.result.killed).toBe("rejected");
    if (result.ok) throw new Error("expected the call to fail");
    expect(result.error.message).toContain("so the guardrail call was stopped");
  });

  it("fails an answer outside the schema as invalid output, and logs a failure", async () => {
    const wrong = await advisorWith(answering({ groups: [] })).advisor.advise(guardrailInput);
    expect(wrong.ok || wrong.error.kind).toBe("invalid-output");
    const { advisor, logger } = advisorWith(syntheticLines("prompt-too-long"));
    const result = await advisor.advise(guardrailInput);
    if (result.ok) throw new Error("expected the call to fail");
    expect(result.error.message).toMatch(
      /^The review's points and the repository's configs are too long/,
    );
    expect(logger.entries).toContainEqual({
      level: "warn",
      message: "The guardrail call failed",
      fields: { transport: "claude-code", ...result.error },
    });
  });
});
