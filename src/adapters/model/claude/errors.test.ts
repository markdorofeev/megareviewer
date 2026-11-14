import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { fromSdkError } from "./errors.ts";

// Status-code mappings are covered through real HTTP responses in the model's tests.
describe("fromSdkError", () => {
  it("maps a timeout to a network error", () => {
    expect(fromSdkError(new Anthropic.APIConnectionTimeoutError()).kind).toBe("network");
  });

  it("maps the SDK's own failures to unexpected", () => {
    const error = new Anthropic.AnthropicError("request ended without sending any chunks");
    expect(fromSdkError(error)).toEqual({
      kind: "unexpected",
      message: "request ended without sending any chunks",
    });
  });

  it("rethrows anything that isn't an SDK error, because it's a bug", () => {
    const bug = new TypeError("cannot read properties of undefined");
    expect(() => fromSdkError(bug)).toThrow(bug);
  });
});
