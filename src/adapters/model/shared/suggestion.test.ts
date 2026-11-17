import { describe, expect, it } from "vitest";
import { suggestedDrafts } from "./fixtures/suggestion.ts";
import { parseSuggestion, SUGGESTION_ANSWER_FORMAT, suggestionError } from "./suggestion.ts";

describe("the suggestion's answer format", () => {
  it("is its own closed schema: proposals of a kind, a text, a scope and evidence", () => {
    expect(SUGGESTION_ANSWER_FORMAT.schema).toEqual({
      type: "object",
      properties: {
        proposals: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["look-for", "dont-flag"] },
              text: { type: "string" },
              scope: { type: "string", enum: ["global", "repo"] },
              evidence: { type: "array", items: { type: "string" } },
            },
            required: ["kind", "text", "scope", "evidence"],
            additionalProperties: false,
          },
        },
      },
      required: ["proposals"],
      additionalProperties: false,
    });
  });
});

describe("parseSuggestion", () => {
  it("returns the drafts of an answer that matches", () => {
    expect(parseSuggestion({ proposals: suggestedDrafts })).toEqual({
      ok: true,
      value: suggestedDrafts,
    });
    expect(parseSuggestion({ proposals: [] })).toEqual({ ok: true, value: [] });
  });

  it.each([
    ["a pass's answer", { answer: { pass: "findings", findings: [] } }],
    ["a kind that isn't one", { proposals: [{ ...suggestedDrafts[0], kind: "always-flag" }] }],
    [
      "a scope that names a repository",
      { proposals: [{ ...suggestedDrafts[0], scope: "acme/api" }] },
    ],
    ["no answer", undefined],
  ])("fails %s as invalid output", (_, answer) => {
    const parsed = parseSuggestion(answer);
    if (parsed.ok) throw new Error("expected the answer to be refused");
    expect(parsed.error.kind).toBe("invalid-output");
  });
});

describe("suggestionError", () => {
  it("says a transport's error in the suggestion's words", () => {
    expect(
      suggestionError({
        kind: "too-large",
        message: "The pull request is too long for the model's context window.",
      }).message,
    ).toBe("Your reviews are too long for the model's context window to suggest preferences from.");
    expect(
      suggestionError({
        kind: "refusal",
        message: "The model declined to analyze this pull request.",
      }).message,
    ).toBe("The model declined to suggest preferences.");
    expect(
      suggestionError({
        kind: "unexpected",
        message: "Codex didn't finish the pass in 10 minutes.",
      }),
    ).toEqual({ kind: "unexpected", message: "Codex didn't finish the suggestion in 10 minutes." });
  });

  it("leaves an error that's about the reviewer's setup as it is", () => {
    const limit = {
      kind: "rate-limited",
      message: "Your Claude plan's usage limit is reached.",
    } as const;
    expect(suggestionError(limit)).toEqual(limit);
  });
});
