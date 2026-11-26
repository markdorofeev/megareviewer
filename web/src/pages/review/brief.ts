import {
  isTestFile,
  type PartId,
  type UnchangedCallers,
} from "../../../../src/domain/diff/index.ts";
import { codeUses } from "./outside-uses.ts";
import { type FileOverview, type OverviewNode, uniqueLabels } from "./overview.ts";

// The intent's brief before the model has run: what the code alone says about the shape of the
// change and its reach, from the overview's rows and the unchanged callers.

/** A directory the change runs through, and where users reach it there. */
export interface Stop {
  readonly label: string;
  readonly entries: readonly string[];
}

export interface Through {
  /** The overview's rows, callers first; one row when nothing links them. */
  readonly rows: readonly (readonly Stop[])[];
  /** Whether the rows are a call order, or only the directories, none calling another. */
  readonly linked: boolean;
  /** Directories left out: past the limit, or apart from the linked ones. */
  readonly more: number;
}

/** At most this many directories, so the line stays one line on a wide window. */
export const MAX_STOPS = 8;

/** What the brief names: changed code to read, not tests, generated or mechanical files. */
const named = (node: OverviewNode): boolean => !node.generated && node.risk !== "mechanical";

const pathOf = (node: OverviewNode): string =>
  node.kind === "group" ? node.key.slice("group:".length) || "." : node.key;

/**
 * The overview's rows as a line: each directory by as much of its path as tells it from the
 * others, with its entries. Null when no changed code is left to name.
 */
export const throughOf = (overview: FileOverview): Through | null => {
  const linkedRows = overview.rows.map((row) => row.filter(named)).filter((row) => row.length > 0);
  const apart = overview.strip.filter(named);
  const linked = linkedRows.length > 0;
  const rows = linked ? linkedRows : [apart];
  const nodes = rows.flat();
  if (nodes.length === 0) return null;
  const labels = uniqueLabels(nodes.map(pathOf));
  let left = MAX_STOPS;
  const shown = rows
    .map((row) =>
      row.flatMap((node) => {
        if (left === 0) return [];
        left -= 1;
        return [{ label: labels.get(pathOf(node)) ?? pathOf(node), entries: node.entries }];
      }),
    )
    .filter((row) => row.length > 0);
  return {
    rows: shown,
    linked,
    more: nodes.length - shown.flat().length + (linked ? apart.length : 0),
  };
};

export interface Reach {
  /** The changed definitions code outside the pull request uses, in the analysis's order. */
  readonly symbols: readonly string[];
  /** Their uses in code outside the pull request, counting those past the analysis's limit. */
  readonly uses: number;
}

/**
 * What the change reaches past itself: definitions it changes that unchanged code uses. Tests
 * and their helpers are left out, on either end: a fake that tests use isn't a regression's path.
 */
export const reachOf = (
  callers: readonly UnchangedCallers[],
  pathOfPart: (id: PartId) => string | undefined,
): Reach | null => {
  const used = callers.flatMap((one) => {
    const path = pathOfPart(one.partId);
    if (path === undefined || isTestFile(path)) return [];
    const uses = codeUses(one);
    return uses === 0 ? [] : [{ symbol: one.symbol, uses }];
  });
  if (used.length === 0) return null;
  return {
    symbols: [...new Set(used.map((one) => one.symbol))],
    uses: used.reduce((sum, one) => sum + one.uses, 0),
  };
};

/** A piece of model text: code where it was in backticks, plain text elsewhere. */
export interface TextPiece {
  readonly text: string;
  readonly code: boolean;
}

/** Splits model text at its code spans, so the page can set them in code without HTML. */
export const codeSpans = (text: string): TextPiece[] =>
  text
    .split(/`([^`\n]+)`/)
    .map((piece, at) => ({ text: piece, code: at % 2 === 1 }))
    .filter((piece) => piece.text !== "");
