import {
  type CallGraphHint,
  type CallSite,
  type FileChange,
  hunkIdOf,
} from "../../../src/domain/diff/index.ts";

/** A call site at each call hint's line, where its symbol is on it, as prep would find. */
export const callSitesOf = (
  files: readonly FileChange[],
  callGraph: readonly CallGraphHint[],
): CallSite[] =>
  callGraph.flatMap((hint) => {
    if (hint.use === "request") return [];
    const hunkId = hunkIdOf(hint.fromPartId);
    const file = files.find((one) => one.hunks.some((hunk) => hunk.id === hunkId));
    const text = file?.hunks
      .find((hunk) => hunk.id === hunkId)
      ?.lines.find((line) => line.kind !== "del" && line.newLine === hint.line)?.text;
    const column = text?.search(new RegExp(`\\b${hint.symbol}\\b`)) ?? -1;
    return file === undefined || column < 0
      ? []
      : [
          {
            partId: hint.fromPartId,
            path: file.path,
            line: hint.line,
            column,
            length: hint.symbol.length,
            symbol: hint.symbol,
            toPartIds: [hint.toPartId],
          },
        ];
  });
