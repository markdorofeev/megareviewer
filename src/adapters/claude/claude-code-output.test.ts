import { describe, expect, it } from "vitest";
import { parseClaudeCodeStream } from "./claude-code-output.ts";
import { recordedLines } from "./fixtures/fake-run-claude.ts";

describe("parseClaudeCodeStream", () => {
  it("reads the session, the plan's window and the answer from a recorded pass", () => {
    const stream = parseClaudeCodeStream(recordedLines("risk"));
    expect(stream.init).toEqual({
      tools: ["StructuredOutput"],
      mcpServers: [],
      apiKeySource: "none",
      version: "2.1.303",
    });
    expect(stream.rateLimit).toMatchObject({ status: "allowed", window: "five_hour" });
    expect(stream.error).toBeNull();
    expect(stream.result).toMatchObject({
      isError: false,
      subtype: "success",
      structuredOutput: { answer: { pass: "risk" } },
    });
  });

  it("reads the error Claude Code made up when it isn't signed in", () => {
    expect(parseClaudeCodeStream(recordedLines("not-signed-in")).error).toEqual({
      code: "authentication_failed",
      text: "Not logged in · Please run /login",
    });
  });

  it("ignores lines that aren't events it knows", () => {
    const stream = parseClaudeCodeStream([
      "not json",
      JSON.stringify({ type: "system", subtype: "thinking_tokens", estimated_tokens: 50 }),
      JSON.stringify({ type: "something_new" }),
    ]);
    expect(stream).toEqual({ init: null, rateLimit: null, error: null, result: null });
  });
});
