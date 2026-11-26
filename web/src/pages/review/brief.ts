// The intent's brief is model text, which writes code names in backticks.

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
