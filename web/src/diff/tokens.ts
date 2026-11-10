import type { CharRange } from "./intra-line.ts";

/** A run of code with one style. */
export interface CodeToken {
  readonly text: string;
  /** Colors for the light and dark themes; null for plain text. */
  readonly light: string | null;
  readonly dark: string | null;
  readonly italic: boolean;
  readonly bold: boolean;
}

/** A piece of a token, inside or outside an intra-line change. */
export interface Segment extends CodeToken {
  readonly changed: boolean;
}

export const plainTokens = (text: string): readonly CodeToken[] =>
  text === "" ? [] : [{ text, light: null, dark: null, italic: false, bold: false }];

/** Splits tokens at the edges of the changed ranges. */
export const segmentLine = (
  tokens: readonly CodeToken[],
  changed: readonly CharRange[],
): Segment[] => {
  const segments: Segment[] = [];
  let offset = 0;
  for (const token of tokens) {
    const end = offset + token.text.length;
    const cuts = new Set([offset, end]);
    for (const range of changed) {
      if (range.start > offset && range.start < end) cuts.add(range.start);
      if (range.end > offset && range.end < end) cuts.add(range.end);
    }
    const edges = [...cuts].sort((x, y) => x - y);
    for (let i = 0; i + 1 < edges.length; i++) {
      const start = edges[i] ?? offset;
      const stop = edges[i + 1] ?? end;
      segments.push({
        ...token,
        text: token.text.slice(start - offset, stop - offset),
        changed: changed.some((range) => range.start <= start && stop <= range.end),
      });
    }
    offset = end;
  }
  return segments;
};
