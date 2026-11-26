import type { AnalysisInput } from "../../application/ports/index.ts";
import type { Hunk } from "../../domain/diff/index.ts";

export const hunkWith = (input: AnalysisInput, path: string, text: string): Hunk | undefined =>
  input.files
    .find((file) => file.path === path)
    ?.hunks.find((hunk) => hunk.lines.some((line) => line.text.includes(text)));

export const lineOf = (hunk: Hunk, text: string): number =>
  hunk.lines.find((line) => line.kind !== "del" && line.text.includes(text))?.newLine ?? 1;
