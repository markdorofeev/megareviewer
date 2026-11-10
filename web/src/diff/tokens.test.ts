import { describe, expect, it } from "vitest";
import { type CodeToken, plainTokens, segmentLine } from "./tokens.ts";

const token = (text: string, light: string | null = null): CodeToken => ({
  text,
  light,
  dark: light,
  italic: false,
  bold: false,
});

const shape = (segments: ReturnType<typeof segmentLine>) =>
  segments.map(({ text, light, changed }) => [text, light, changed]);

describe("segmentLine", () => {
  it("returns the tokens unchanged without ranges", () => {
    expect(shape(segmentLine([token("const", "#f00"), token(" a")], []))).toEqual([
      ["const", "#f00", false],
      [" a", null, false],
    ]);
  });

  it("splits tokens at range edges and keeps each piece's style", () => {
    const tokens = [token("total", "#00f"), token(" += "), token("price", "#00f")];
    expect(shape(segmentLine(tokens, [{ start: 2, end: 11 }]))).toEqual([
      ["to", "#00f", false],
      ["tal", "#00f", true],
      [" += ", null, true],
      ["pr", "#00f", true],
      ["ice", "#00f", false],
    ]);
  });

  it("handles several ranges in one token", () => {
    expect(
      shape(
        segmentLine(
          [token("abcdef")],
          [
            { start: 1, end: 2 },
            { start: 4, end: 5 },
          ],
        ),
      ),
    ).toEqual([
      ["a", null, false],
      ["b", null, true],
      ["cd", null, false],
      ["e", null, true],
      ["f", null, false],
    ]);
  });

  it("has nothing for an empty line", () => {
    expect(segmentLine(plainTokens(""), [])).toEqual([]);
  });
});
