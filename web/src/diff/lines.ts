import type { DiffLine, Hunk } from "../../../src/domain/diff/index.ts";

/** A diff line as shown: its text without a trailing carriage return. */
export interface DisplayLine {
  readonly line: DiffLine;
  readonly text: string;
  /**
   * The line ends in a carriage return while others in the hunk don't. A CRLF file needs no mark
   * on every line, but a line whose only change is its ending would look unchanged without one.
   */
  readonly carriageReturn: boolean;
}

export const displayLines = (lines: readonly DiffLine[]): DisplayLine[] => {
  const endsInCr = lines.map((line) => line.text.endsWith("\r"));
  const mixed = endsInCr.includes(true) && endsInCr.includes(false);
  return lines.map((line, i) => ({
    line,
    text: endsInCr[i] ? line.text.slice(0, -1) : line.text,
    carriageReturn: mixed && endsInCr[i] === true,
  }));
};

export const lineCounts = (
  hunk: Pick<Hunk, "lines">,
): { readonly added: number; readonly deleted: number } => ({
  added: hunk.lines.filter((line) => line.kind === "add").length,
  deleted: hunk.lines.filter((line) => line.kind === "del").length,
});

const span = (start: number, count: number): string =>
  count <= 1 ? `${start}` : `${start}–${start + count - 1}`;

/** Where the hunk is, for its accessible name: new lines, or old ones when nothing is left. */
export const hunkLocation = (hunk: Hunk): string =>
  hunk.newLines > 0
    ? `lines ${span(hunk.newStart, hunk.newLines)}`
    : `deleted lines ${span(hunk.oldStart, hunk.oldLines)}`;
