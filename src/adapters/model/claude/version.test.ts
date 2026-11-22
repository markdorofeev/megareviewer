import { describe, expect, it } from "vitest";
import { smallFeatureInput, smallFeatureIntent } from "../../../application/testing/index.ts";
import { MODEL_STAGES, ModelPass } from "../../../domain/review/index.ts";
import { fnv1a64 } from "../../../domain/shared/index.ts";
import { passMessage } from "../shared/prompts/passes.ts";
import { renderInput } from "../shared/render-input.ts";
import { passRequest } from "./request.ts";
import {
  apiVersion,
  PROMPT_FINGERPRINT,
  PROMPT_VERSION,
  TOUR_FINGERPRINT,
  VERSION,
} from "./version.ts";

/**
 * Every pass's full request for a fixture on Haiku 5.5, with feedback: the system prompt,
 * pass instructions, rendering, output schema and request settings all show up in it. Without the
 * tour, the review's four passes; with it, every pass, the steps pass among them.
 */
const fingerprint = (tour = false): string =>
  fnv1a64(
    JSON.stringify(
      (tour ? ModelPass.options : MODEL_STAGES).map((pass) =>
        passRequest(
          pass,
          renderInput(smallFeatureInput),
          passMessage(pass, pass === "findings" ? smallFeatureIntent : null, ["problem"]),
          "claude-haiku-5-5",
          tour,
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

  it("is bumped whenever a run with the tour changes its requests", () => {
    const current = fingerprint(true);
    expect(
      current,
      `A run with the tour changed its requests. Bump PROMPT_VERSION in version.ts (now ` +
        `${PROMPT_VERSION}) and set TOUR_FINGERPRINT to "${current}".`,
    ).toBe(TOUR_FINGERPRINT);
  });

  it("is part of the version, with the model", () => {
    expect(apiVersion("claude-haiku-5-5")).toBe(`claude-haiku-5-5/p${PROMPT_VERSION}`);
    expect(VERSION).toBe(`claude-sonnet-5-5/p${PROMPT_VERSION}`);
  });
});
