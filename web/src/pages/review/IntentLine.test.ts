import { describe, expect, it } from "vitest";
import { firstLine, firstSentence } from "./IntentLine.tsx";

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

describe("firstSentence", () => {
  it("keeps the first sentence of a paragraph", () => {
    expect(
      firstSentence(
        "Opening a review took 17s on a slow link. On that link each connection is slow.",
      ),
    ).toBe("Opening a review took 17s on a slow link.");
    expect(firstSentence("Is it slow? Yes.")).toBe("Is it slow?");
  });

  it("doesn't end a sentence at an abbreviation, a version or a file name", () => {
    expect(firstSentence("Adds caching, e.g. for receipts. More.")).toBe(
      "Adds caching, e.g. for receipts.",
    );
    expect(firstSentence("Bumps Node to 24.21 in package.json today")).toBe(
      "Bumps Node to 24.21 in package.json today",
    );
  });
});
