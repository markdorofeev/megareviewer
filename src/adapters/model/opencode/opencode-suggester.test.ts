import { describe, expect, it } from "vitest";
import { RecordingLogger } from "../../../application/testing/index.ts";
import type { ModelErrorKind } from "../../../domain/review/index.ts";
import { suggestedDrafts, suggestionInput } from "../shared/fixtures/suggestion.ts";
import { SUGGEST_SYSTEM_PROMPT } from "../shared/prompts/suggest.ts";
import { SUGGESTION_ANSWER_FORMAT } from "../shared/suggestion.ts";
import {
  createFakeOpencodeClient,
  recorded,
  sessionWith,
} from "./fixtures/fake-opencode-client.ts";
import { opencodeConfig, SUGGEST_AGENT } from "./opencode-request.ts";
import { createOpencodeSuggester } from "./opencode-suggester.ts";

/** Synthetic: the recorded intent session, its answer's text replaced. */
const saying = (text: string, ...also: Record<string, unknown>[]) =>
  sessionWith("intent", (messages) =>
    messages.map((message) =>
      message.type === "assistant"
        ? { ...message, content: [...also, { type: "text", text }] }
        : message,
    ),
  );

const proposals = JSON.stringify({ proposals: suggestedDrafts });

const suggesterWith = (answer: unknown = saying(proposals), priced = true) => {
  const fake = createFakeOpencodeClient(() => answer);
  const logger = new RecordingLogger();
  const suggester = createOpencodeSuggester({
    client: fake.client,
    providerID: "anthropic",
    model: "claude-haiku-5-5",
    variants: ["none", "low", "medium", "high", "xhigh", "max"],
    priced,
    logger,
  });
  return { suggester, calls: fake.calls, logger };
};

const expectFailure = async (answer: unknown, kind: ModelErrorKind, message: RegExp) => {
  const setup = suggesterWith(answer);
  const result = await setup.suggester.suggest(suggestionInput);
  if (result.ok) throw new Error("expected the call to fail");
  expect(result.error.kind).toBe(kind);
  expect(result.error.message).toMatch(message);
  return setup;
};

describe("OpencodeSuggester", () => {
  it("returns the proposals and what opencode says the call cost, billed to the reviewer's key", async () => {
    const result = await suggesterWith().suggester.suggest(suggestionInput);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.value).toEqual(suggestedDrafts);
    expect(result.value.usage).toEqual({
      inputTokens: 4,
      cacheReadTokens: 0,
      cacheWriteTokens: 5669,
      outputTokens: 1700,
      costUsd: expect.closeTo(0.00156, 5),
      billing: "api",
    });
  });

  it("leaves the cost unknown for a model opencode doesn't price", async () => {
    const result = await suggesterWith(undefined, false).suggester.suggest(suggestionInput);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.usage.costUsd).toBeNull();
  });

  it("runs a session of its own as the suggestion agent, with no PR entries, and deletes it", async () => {
    const { suggester, calls } = suggesterWith();
    await suggester.suggest(suggestionInput);
    expect(calls[0]).toEqual({
      method: "POST",
      path: "/api/session",
      body: {
        agent: SUGGEST_AGENT,
        title: "megareviewer",
        model: { providerID: "anthropic", id: "claude-haiku-5-5", variant: "medium" },
      },
    });
    expect(calls.filter((call) => call.path.includes("/instructions/entries/"))).toEqual([]);
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", path: "/api/session/ses_fake1" });
  });

  it("sends the history as data, the task, then the schema of its answer", async () => {
    const { suggester, calls } = suggesterWith();
    await suggester.suggest(suggestionInput);
    const prompt = calls.find((call) => call.path.endsWith("/prompt"))?.body;
    const text =
      typeof prompt === "object" && prompt !== null && "text" in prompt ? String(prompt.text) : "";
    expect(text.startsWith("<review_history>")).toBe(true);
    expect(text).toMatch(/^Task: suggest\.$/m);
    expect(text).toMatch(/Answer with one JSON object and nothing else/);
    expect(text.endsWith(JSON.stringify(SUGGESTION_ANSWER_FORMAT.schema))).toBe(true);
  });

  it("is an agent of the server's config with its own instructions, denied every tool", () => {
    const { agents } = opencodeConfig();
    expect(agents).toMatchObject({
      [SUGGEST_AGENT]: {
        mode: "primary",
        hidden: true,
        system: SUGGEST_SYSTEM_PROMPT,
        permissions: [{ action: "*", resource: "*", effect: "deny" }],
      },
    });
  });

  it("reads an answer wrapped in a code fence", async () => {
    const { suggester } = suggesterWith(saying(`\`\`\`json\n${proposals}\n\`\`\``));
    const result = await suggester.suggest(suggestionInput);
    expect(result.ok ? result.value.value : null).toEqual(suggestedDrafts);
  });

  it("fails an answer that isn't JSON, or isn't proposals, as invalid output", async () => {
    await expectFailure(saying("I can't do that."), "invalid-output", /one JSON object/);
    await expectFailure(recorded("intent"), "invalid-output", /proposals/);
  });

  it.each<[string, unknown]>([
    [
      "a tool call",
      saying(proposals, { type: "tool", id: "t1", name: "skill", executed: false, state: {} }),
    ],
    [
      "a shell",
      sessionWith("intent", (messages) => [
        { type: "shell", command: "curl http://127.0.0.1:8766", status: "exited" },
        ...messages,
      ]),
    ],
  ])("discards the answer of a session with %s, and deletes it", async (_, session) => {
    const { calls } = await expectFailure(
      session,
      "unexpected",
      /used a tool .*so the suggestion was stopped and its answer discarded/,
    );
    expect(calls.at(-1)?.method).toBe("DELETE");
  });

  it("passes on a provider's failure, and logs it", async () => {
    const { logger } = await expectFailure(recorded("provider-error"), "unexpected", /opencode/);
    expect(logger.entries).toContainEqual(
      expect.objectContaining({
        level: "warn",
        message: "Suggesting preferences failed",
        fields: expect.objectContaining({ transport: "opencode" }),
      }),
    );
  });
});
