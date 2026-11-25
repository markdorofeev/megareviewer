import { describe, expect, it } from "vitest";
import type { AnalysisInput } from "../../../application/ports/index.ts";
import { smallFeatureInput, smallFeatureIntent } from "../../../application/testing/index.ts";
import { MODEL_STAGES, type ModelPass } from "../../../domain/review/index.ts";
import { fnv1a64 } from "../../../domain/shared/index.ts";
import { passMessage } from "../shared/prompts/passes.ts";
import { renderInput } from "../shared/render-input.ts";
import { passRequest } from "./request.ts";
import {
  apiVersion,
  PROMPT_FINGERPRINT,
  PROMPT_VERSION,
  READER_FINGERPRINT,
  TOUR_FINGERPRINT,
  VERSION,
} from "./version.ts";

/**
 * The passes' full requests for a fixture on Haiku 5.5, with feedback: the system prompt, pass
 * instructions, rendering, answer schema and request settings all show up in them. A run sends the
 * review's four the same with the tour or without, so the steps pass's has a fingerprint of its own.
 */
const fingerprint = (
  passes: readonly ModelPass[] = MODEL_STAGES,
  input: AnalysisInput = smallFeatureInput,
): string => {
  const reads = input.harness !== null;
  return fnv1a64(
    JSON.stringify(
      passes.map((pass) =>
        passRequest(
          pass,
          renderInput(input),
          passMessage(pass, pass === "findings" ? smallFeatureIntent : null, ["problem"], reads),
          "claude-haiku-5-5",
          reads,
        ),
      ),
    ),
  );
};

describe("prompt version", () => {
  it("is bumped whenever the prompts, rendering, schema or request settings change", () => {
    const current = fingerprint();
    expect(
      current,
      `The prompts or request changed. Bump PROMPT_VERSION in version.ts (now ${PROMPT_VERSION}) ` +
        `and set PROMPT_FINGERPRINT to "${current}", so cached analyses made with the old ` +
        "prompts aren't served.",
    ).toBe(PROMPT_FINGERPRINT);
  });

  it("is bumped whenever the steps pass's request changes", () => {
    const current = fingerprint(["steps"]);
    expect(
      current,
      `The steps pass's request changed. Bump PROMPT_VERSION in version.ts (now ` +
        `${PROMPT_VERSION}) and set TOUR_FINGERPRINT to "${current}".`,
    ).toBe(TOUR_FINGERPRINT);
  });

  it("is bumped whenever a run with something to read sends something else", () => {
    const current = fingerprint(MODEL_STAGES, {
      ...smallFeatureInput,
      harness: {
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
      },
    });
    expect(
      current,
      `A run with something to read sends something else. Bump PROMPT_VERSION in version.ts (now ` +
        `${PROMPT_VERSION}) and set READER_FINGERPRINT to "${current}".`,
    ).toBe(READER_FINGERPRINT);
  });

  it("is part of the version, with the model", () => {
    expect(apiVersion("claude-haiku-5-5")).toBe(`claude-haiku-5-5/p${PROMPT_VERSION}`);
    expect(VERSION).toBe(`claude-sonnet-5-5/p${PROMPT_VERSION}`);
  });
});
