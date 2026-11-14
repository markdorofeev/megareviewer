import { describe, expect, it } from "vitest";
import { runStructuredCall } from "./claude-code-call.ts";
import { SYSTEM_PROMPT_FILE } from "./claude-code-request.ts";
import {
  createFakeRunClaude,
  recordedLines,
  type SyntheticRun,
  syntheticLines,
} from "./fixtures/fake-run-claude.ts";

const call = {
  model: "claude-opus-5-5",
  effort: "medium",
  systemPrompt: "Grade this.\n\n<pull_request_data>…</pull_request_data>",
  schema: { type: "object", properties: { ok: { type: "boolean" } } },
  message: "The items to grade",
  onPlan: true,
} as const;

const flag = (args: readonly string[], name: string) => args[args.indexOf(name) + 1];

describe("runStructuredCall", () => {
  it("runs the given model, effort and schema, the prompt in the file and the message on stdin", async () => {
    const fake = createFakeRunClaude(() => recordedLines("intent"));
    const answered = await runStructuredCall(fake.run, call);
    if (!answered.ok) throw new Error(answered.error.message);
    const [made] = fake.calls;
    expect(flag(made?.args ?? [], "--model")).toBe("claude-opus-5-5");
    expect(flag(made?.args ?? [], "--effort")).toBe("medium");
    expect(JSON.parse(flag(made?.args ?? [], "--json-schema") ?? "")).toEqual(call.schema);
    expect(flag(made?.args ?? [], "--tools")).toBe("");
    expect(made?.options.files?.[SYSTEM_PROMPT_FILE]).toBe(call.systemPrompt);
    expect(made?.options.stdin).toBe(call.message);
    expect(answered.value).toMatchObject({
      answer: { answer: { pass: "intent" } },
      version: "2.1.303",
      models: ["claude-haiku-5-5"],
    });
  });

  it("names the model the session started on first", async () => {
    const [init = "", ...rest] = recordedLines("intent");
    const fake = createFakeRunClaude(() => [
      JSON.stringify({ ...JSON.parse(init), model: "claude-opus-5-5" }),
      ...rest,
    ]);
    const answered = await runStructuredCall(fake.run, call);
    if (!answered.ok) throw new Error(answered.error.message);
    expect(answered.value.models).toEqual(["claude-opus-5-5", "claude-haiku-5-5"]);
  });

  it.each<SyntheticRun>(["tools", "mcp-server", "api-key"])(
    "stops a session with %s before it answers",
    async (name) => {
      const fake = createFakeRunClaude(() => [
        ...syntheticLines(name),
        ...recordedLines("intent").slice(1),
      ]);
      const answered = await runStructuredCall(fake.run, call);
      expect(fake.calls[0]?.result.killed).toBe("rejected");
      if (answered.ok) throw new Error("expected the call to fail");
      expect(answered.error.message).toMatch(/wasn't locked down/);
    },
  );

  it("fails an answer without the session's first event", async () => {
    const fake = createFakeRunClaude(() => recordedLines("intent").slice(1));
    const answered = await runStructuredCall(fake.run, call);
    if (answered.ok) throw new Error("expected the call to fail");
    expect(answered.error.message).toMatch(/no session/);
  });
});
