import { describe, expect, it } from "vitest";
import { smallFeatureIntent } from "../../../../application/testing/index.ts";
import { InferredIntent } from "../../../../domain/review/index.ts";
import { PASS_INSTRUCTIONS, passMessage } from "./passes.ts";

describe("the intent task", () => {
  it("says how to write each field of the inferred intent", () => {
    for (const field of Object.keys(InferredIntent.unwrap().shape)) {
      expect(PASS_INSTRUCTIONS.intent).toMatch(new RegExp(`^ {2}- ${field}: `, "m"));
    }
  });

  it("keeps the brief short: words per line and lines to watch", () => {
    expect(PASS_INSTRUCTIONS.intent).toContain("one sentence of at most 20 words");
    expect(PASS_INSTRUCTIONS.intent).toContain(
      "one sentence of at most 25 words: where it's reached",
    );
    expect(PASS_INSTRUCTIONS.intent).toContain("at most 2 things");
  });
});

describe("the risk task", () => {
  it("asks for a checking test only when its assertions would fail if the risk's behavior broke", () => {
    expect(PASS_INSTRUCTIONS.risk).toMatch(/^checkedBy: for a contract hunk/m);
    expect(PASS_INSTRUCTIONS.risk).toContain("would this test fail?");
    expect(PASS_INSTRUCTIONS.risk).toContain(
      "never by its name, its comments, or what the description or a comment says is tested",
    );
    expect(PASS_INSTRUCTIONS.risk).toContain("When unsure, null");
  });
});

describe("passMessage", () => {
  it("gives findings the intent's summary and mismatches by ID, not its brief", () => {
    const message = passMessage("findings", smallFeatureIntent, undefined);
    expect(message).toContain(`Inferred: ${smallFeatureIntent.inferred.summary}`);
    expect(message).toMatch(/^- m1 unrequested: /m);
    expect(message).not.toContain(smallFeatureIntent.inferred.shape);
    expect(message).not.toContain(smallFeatureIntent.inferred.watch[0]);
  });

  it("gives the intent task nothing earlier, and the previous attempt's problems last", () => {
    const message = passMessage("intent", null, ["h_1 doesn't exist"]);
    expect(message.startsWith("Task: intent.")).toBe(true);
    expect(
      message.endsWith("Your previous answer had these problems: h_1 doesn't exist. Fix them."),
    ).toBe(true);
  });
});
