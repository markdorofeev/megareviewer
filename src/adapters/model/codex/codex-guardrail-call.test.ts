import { describe, expect, it } from "vitest";
import { RecordingLogger } from "../../../application/testing/index.ts";
import { guardrailAnswer, guardrailInput } from "../shared/fixtures/guardrail-call.ts";
import { GUARDRAIL_ANSWER_FORMAT } from "../shared/guardrail-call.ts";
import { GUARDRAILS_SYSTEM_PROMPT } from "../shared/prompts/guardrails.ts";
import { createCodexAdvisor } from "./codex-one-call.ts";
import { INSTRUCTIONS_FILE, SCHEMA_FILE } from "./codex-request.ts";
import { createFakeRunCodex, recordedLines } from "./fixtures/fake-run-codex.ts";

/** Synthetic: the recorded intent session, its last message saying `answer`. */
const saying = (answer: unknown): string[] =>
  recordedLines("intent").map((line) =>
    line.includes("agent_message")
      ? JSON.stringify({
          type: "item.completed",
          item: { id: "item_1", type: "agent_message", text: JSON.stringify(answer) },
        })
      : line,
  );

const advisorWith = (answer: readonly string[] = saying(guardrailAnswer)) => {
  const fake = createFakeRunCodex(() => answer);
  const advisor = createCodexAdvisor({
    run: fake.run,
    billing: "plan",
    model: "gpt-6-luna",
    efforts: ["low", "medium", "high"],
    logger: new RecordingLogger(),
  });
  return { advisor, calls: fake.calls };
};

describe("CodexAdvisor's guardrail call", () => {
  it("returns the marks, billed to the plan", async () => {
    const result = await advisorWith().advisor.advise(guardrailInput);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.value).toEqual(guardrailAnswer);
    expect(result.value.usage.billing).toBe("plan");
  });

  it("runs one locked-down call: its own instructions and schema, the data on stdin", async () => {
    const { advisor, calls } = advisorWith();
    await advisor.advise(guardrailInput);
    const args = calls[0]?.args ?? [];
    expect(args).toContain("model_reasoning_effort=medium");
    expect(args[args.indexOf("--sandbox") + 1]).toBe("read-only");
    expect(calls[0]?.options.files).toEqual({
      [INSTRUCTIONS_FILE]: GUARDRAILS_SYSTEM_PROMPT,
      [SCHEMA_FILE]: JSON.stringify(GUARDRAIL_ANSWER_FORMAT.schema),
    });
    expect(calls[0]?.options.stdin).toMatch(/^Task: guardrails\.$/m);
  });

  it("kills a session that used a tool, in the call's words", async () => {
    const result = await advisorWith(recordedLines("command")).advisor.advise(guardrailInput);
    if (result.ok) throw new Error("expected the call to fail");
    expect(result.error.message).toMatch(
      /so the guardrail call was stopped and its answer discarded/,
    );
  });

  it("fails an answer outside the schema as invalid output", async () => {
    const result = await advisorWith(saying({ groups: [] })).advisor.advise(guardrailInput);
    expect(result.ok || result.error.kind).toBe("invalid-output");
  });
});
