import { describe, expect, it } from "vitest";
import { firstLine } from "./IntentLine.tsx";

describe("firstLine", () => {
  it("is the description's first line with text", () => {
    expect(firstLine("\n  Adds receipts.  \nAnd more.")).toBe("Adds receipts.");
    expect(firstLine("")).toBe("");
  });

  it("skips Markdown headings, unless there's nothing else", () => {
    expect(firstLine("## What changed\n\n- Shows accounts on the setup page")).toBe(
      "- Shows accounts on the setup page",
    );
    expect(firstLine("# Summary\n## Details")).toBe("Summary");
    expect(firstLine("#hashtag is text")).toBe("#hashtag is text");
  });
});
