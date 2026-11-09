// Pure, and importing only domain types, so scripts/measure-pr.ts can count chips the same way.
import type { PartId } from "../../../../src/domain/diff/index.ts";

/**
 * A call the code makes on one of its lines, to the hunk that changes what it calls. A request is
 * an HTTP request to the part that adds its route; its symbol is the route's method and path.
 */
export interface Call {
  readonly symbol: string;
  readonly toPartId: PartId;
  readonly line: number;
  readonly request?: true;
}

/** Where a symbol stands in a line's text: characters `start` to `end`, end excluded. */
export interface SymbolPlace {
  readonly start: number;
  readonly end: number;
}

/**
 * How one symbol on one line shows its calls: a chip, which opens the called code in place, or a
 * mention, which peeks at it and goes there. `calls` has one call per hunk the symbol reaches, more
 * for an ambiguous call. A chip whose symbol is on the line (`at`) is the symbol itself, clickable;
 * one that isn't, such as a request or a call spread over lines, is a row under the line.
 */
export type CallMark =
  | {
      readonly kind: "chip";
      readonly symbol: string;
      readonly calls: readonly Call[];
      readonly at: SymbolPlace | null;
    }
  | {
      readonly kind: "mention";
      readonly symbol: string;
      readonly calls: readonly Call[];
      readonly at: SymbolPlace;
    };

/** Each hunk's marks by the new-side line they're on, in the order the symbols are called. */
export type ChipPlan = ReadonlyMap<PartId, ReadonlyMap<number, readonly CallMark[]>>;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The symbol's first place in the text as a whole word, or null when it isn't there. */
export const symbolPlace = (text: string, symbol: string): SymbolPlace | null => {
  if (symbol === "") return null;
  const match = new RegExp(`(?<![\\w$])${escapeRegExp(symbol)}(?![\\w$])`).exec(text);
  return match === null ? null : { start: match.index, end: match.index + symbol.length };
};

/**
 * Which calls get a chip on the map. Within each section (a tour step, or the one list of files
 * before the tour exists), read in order, the first call to a hunk gets a chip and a later call to
 * it is a mention. The calls on a line with one symbol are one mark, a chip when any of their hunks
 * is new to the section. A mention whose symbol isn't on the line's text, such as a call spread
 * over lines, stays a chip: when unsure, show more. Every call is in exactly one mark.
 */
export const chipPlan = (
  sections: readonly (readonly PartId[])[],
  calls: ReadonlyMap<PartId, ReadonlyMap<number, readonly Call[]>>,
  lineText: (id: PartId, line: number) => string | undefined,
): ChipPlan => {
  const plan = new Map<PartId, Map<number, CallMark[]>>();
  for (const section of sections) {
    const reached = new Set<PartId>();
    for (const id of section) {
      const lines = calls.get(id);
      if (lines === undefined || plan.has(id)) continue;
      const marks = new Map<number, CallMark[]>();
      for (const [line, onLine] of [...lines].sort(([a], [b]) => a - b)) {
        const bySymbol = new Map<string, Call[]>();
        for (const call of onLine)
          bySymbol.set(call.symbol, [...(bySymbol.get(call.symbol) ?? []), call]);
        const lineMarks: CallMark[] = [];
        for (const [symbol, symbolCalls] of bySymbol) {
          const fresh = symbolCalls.some((call) => !reached.has(call.toPartId));
          for (const call of symbolCalls) reached.add(call.toPartId);
          const text = lineText(id, line);
          const at = text === undefined ? null : symbolPlace(text, symbol);
          lineMarks.push(
            fresh || at === null
              ? { kind: "chip", symbol, calls: symbolCalls, at }
              : { kind: "mention", symbol, calls: symbolCalls, at },
          );
        }
        marks.set(line, lineMarks);
      }
      plan.set(id, marks);
    }
  }
  return plan;
};

/** Counts for the measuring script: chips, the ambiguous among them, and mentions. */
export const chipCounts = (plan: ChipPlan) => {
  const marks = [...plan.values()].flatMap((lines) => [...lines.values()].flat());
  const chips = marks.filter((mark) => mark.kind === "chip");
  return {
    chips: chips.length,
    ambiguous: chips.filter((mark) => mark.calls.length > 1).length,
    mentions: marks.length - chips.length,
  };
};
