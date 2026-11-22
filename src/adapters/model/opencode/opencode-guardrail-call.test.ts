import { describe, expect, it } from "vitest";
import { RecordingLogger } from "../../../application/testing/index.ts";
import { guardrailAnswer, guardrailInput } from "../shared/fixtures/guardrail-call.ts";
import { GUARDRAIL_ANSWER_FORMAT } from "../shared/guardrail-call.ts";
import { GUARDRAILS_SYSTEM_PROMPT } from "../shared/prompts/guardrails.ts";
import { createFakeOpencodeClient, sessionWith } from "./fixtures/fake-opencode-client.ts";
import { createOpencodeAdvisor } from "./opencode-one-call.ts";
import { GUARDRAILS_AGENT, opencodeConfig } from "./opencode-request.ts";

/** Synthetic: the recorded intent session, its answer's text replaced. */
const saying = (text: string) =>
  sessionWith("intent", (messages) =>
    messages.map((message) =>
      message.type === "assistant" ? { ...message, content: [{ type: "text", text }] } : message,
    ),
  );

const advisorWith = (answer: unknown = saying(JSON.stringify(guardrailAnswer))) => {
  const fake = createFakeOpencodeClient(() => answer);
  const advisor = createOpencodeAdvisor({
    client: fake.client,
    providerID: "anthropic",
    model: "claude-haiku-5-5",
    variants: ["low", "medium", "high"],
    priced: true,
    logger: new RecordingLogger(),
  });
  return { advisor, calls: fake.calls };
};

describe("OpencodeAdvisor's guardrail call", () => {
  it("returns the marks, billed to the reviewer's key", async () => {
    const result = await advisorWith().advisor.advise(guardrailInput);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.value).toEqual(guardrailAnswer);
    expect(result.value.usage.billing).toBe("api");
  });

  it("runs a session of its own as the guardrail agent, the data then the schema, and deletes it", async () => {
    const { advisor, calls } = advisorWith();
    await advisor.advise(guardrailInput);
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/api/session",
      body: { agent: GUARDRAILS_AGENT, model: { variant: "medium" } },
    });
    const prompt = calls.find((call) => call.path.endsWith("/prompt"))?.body;
    const text =
      typeof prompt === "object" && prompt !== null && "text" in prompt ? String(prompt.text) : "";
    expect(text.startsWith("<guardrail_data>")).toBe(true);
    expect(text.endsWith(JSON.stringify(GUARDRAIL_ANSWER_FORMAT.schema))).toBe(true);
    expect(calls.at(-1)).toMatchObject({ method: "DELETE" });
  });

  it("is an agent of the server's config with its own instructions, denied every tool", () => {
    expect(opencodeConfig().agents).toMatchObject({
      [GUARDRAILS_AGENT]: {
        system: GUARDRAILS_SYSTEM_PROMPT,
        permissions: [{ action: "*", resource: "*", effect: "deny" }],
      },
    });
  });

  it("fails an answer outside the schema as invalid output", async () => {
    const result = await advisorWith(saying('{"groups":[]}')).advisor.advise(guardrailInput);
    expect(result.ok || result.error.kind).toBe("invalid-output");
  });
});
