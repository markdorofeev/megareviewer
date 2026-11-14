import { describe, expect, it } from "vitest";
import type { ModelRisk } from "../../../application/ports/index.ts";
import {
  smallFeatureAnalysis,
  smallFeatureInput,
  smallFeatureIntent,
} from "../../../application/testing/index.ts";
import { ModelPass } from "../../../domain/review/index.ts";
import { fnv1a64 } from "../../../domain/shared/index.ts";
import { passMessage } from "../shared/prompts/passes.ts";
import { renderInput } from "../shared/render-input.ts";
import { passRequest } from "./request.ts";
import { apiVersion, PROMPT_FINGERPRINT, PROMPT_VERSION, VERSION } from "./version.ts";

const risk: ModelRisk[] = smallFeatureAnalysis.risk.flatMap(({ hunkId, riskClass, reason }) =>
  riskClass === "mechanical" ? [] : [{ hunkId, riskClass, reason, lines: null }],
);
const earlier = { intent: smallFeatureIntent, risk, decisions: smallFeatureAnalysis.decisions };

/**
 * Every pass's full request for a fixture on Haiku 5.5, with earlier results and feedback: the system prompt,
 * pass instructions, rendering, output schema and request settings all show up in it.
 */
const fingerprint = (): string =>
  fnv1a64(
    JSON.stringify(
      ModelPass.options.map((pass) =>
        passRequest(
          pass,
          renderInput(smallFeatureInput),
          passMessage(pass, earlier, ["problem"]),
          "claude-haiku-5-5",
        ),
      ),
    ),
  );

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

  it("is part of the version, with the model", () => {
    expect(apiVersion("claude-haiku-5-5")).toBe(`claude-haiku-5-5/p${PROMPT_VERSION}`);
    expect(VERSION).toBe(`claude-sonnet-5-5/p${PROMPT_VERSION}`);
  });
});
