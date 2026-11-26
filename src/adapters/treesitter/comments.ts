import type { Node, Tree } from "web-tree-sitter";

/** What the grammars call a comment. */
const COMMENTS = ["comment", "line_comment", "block_comment"];

// In JSX a comment is the braces around it too.
const wholeComment = (comment: Node): Node =>
  comment.parent?.type === "jsx_expression" && comment.parent.namedChildCount === 1
    ? comment.parent
    : comment;

/** The lines that hold a comment and nothing else. */
export const commentLines = (tree: Tree, source: string): number[] => {
  let code = "";
  let at = 0;
  for (const comment of tree.rootNode.descendantsOfType(COMMENTS)) {
    if (comment === null) continue;
    const { startIndex, endIndex } = wholeComment(comment);
    // A doc comment can hold another node of these types.
    if (startIndex < at) continue;
    code += source.slice(at, startIndex) + source.slice(startIndex, endIndex).replace(/\S/g, " ");
    at = endIndex;
  }
  if (at === 0) return [];
  const left = (code + source.slice(at)).split("\n");
  return source
    .split("\n")
    .flatMap((text, index) =>
      text.trim() !== "" && left[index]?.trim() === "" ? [index + 1] : [],
    );
};
