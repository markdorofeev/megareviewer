import type { Tree } from "web-tree-sitter";
import type { Token } from "../../application/ports/index.ts";

// No node has an empty type, so neither of these compares equal to a real node.

/** Source text inside a node that none of its children cover. Its text is never blank. */
const UNCOVERED_TEXT = "";

/** Closes an inner node, so the list encodes the tree's shape and not just its node order. */
const END_OF_NODE: Token = { type: "", text: "" };

// Only these are ignored between nodes. Anything else, a non-breaking space or a BOM included, is kept.
const IGNORABLE = /^[ \t\r\n]*$/;

/**
 * End markers keep a statement dedented out of a Python block from giving the same list. Text
 * between nodes is kept unless it's whitespace, since a grammar can hide a token's text.
 */
export const syntaxNodes = (tree: Tree, source: string): Token[] => {
  const tokens: Token[] = [];
  const keepUncovered = (from: number, to: number): void => {
    const text = source.slice(from, to);
    if (!IGNORABLE.test(text)) tokens.push({ type: UNCOVERED_TEXT, text });
  };
  // For each open node, the end of what its children cover so far. The first entry is the document,
  // so text before and after the root node is checked too.
  const open = [{ covered: 0, end: source.length }];
  const cursor = tree.walk();
  try {
    for (;;) {
      const parent = open.at(-1);
      if (parent !== undefined) keepUncovered(parent.covered, cursor.startIndex);
      const { nodeType: type, startIndex: start, endIndex: end } = cursor;
      if (cursor.gotoFirstChild()) {
        tokens.push({ type, text: "" });
        open.push({ covered: start, end });
        continue;
      }
      tokens.push({ type, text: source.slice(start, end) });
      if (parent !== undefined) parent.covered = end;
      while (!cursor.gotoNextSibling()) {
        const closed = open.pop();
        if (closed === undefined) throw new Error("tree cursor left the document");
        keepUncovered(closed.covered, closed.end);
        if (open.length === 0) return tokens;
        tokens.push(END_OF_NODE);
        cursor.gotoParent();
        const grandparent = open.at(-1);
        if (grandparent !== undefined) grandparent.covered = closed.end;
      }
    }
  } finally {
    cursor.delete();
  }
};
