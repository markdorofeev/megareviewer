import { describe, expect, it } from "vitest";
import { firstLine } from "./IntentLine.tsx";

describe("firstLine", () => {
  it("is the description's first line with text", () => {
    expect(firstLine("\n  Adds receipts.  \nAnd more.")).toBe("Adds receipts.");
    expect(firstLine("")).toBe("");
  });

  it("skips Markdown headings, unless there's nothing else", () => {
    expect(firstLine("## What changed\n\n- Shows accounts on the setup page")).toBe(
      "Shows accounts on the setup page",
    );
    expect(firstLine("# Summary\n## Details")).toBe("Summary");
    expect(firstLine("#hashtag is text")).toBe("#hashtag is text");
  });
});

it("removes inline Markdown without rendering untrusted HTML", () => {
  expect(
    firstLine(
      "- Connect **Bitbucket and GitHub accounts** using `tokens` and [settings](https://example.com).",
    ),
  ).toBe("Connect Bitbucket and GitHub accounts using tokens and settings.");
  expect(firstLine("<script>alert(1)</script> **text**")).toBe("<script>alert(1)</script> text");
  expect(firstLine("Use snake_case and 2 * 3.")).toBe("Use snake_case and 2 * 3.");
});
