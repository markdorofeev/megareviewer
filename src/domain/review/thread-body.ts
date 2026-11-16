import { attachmentHost } from "./attachments.ts";

// A comment body is untrusted host content. It's read into the blocks and spans of the Markdown
// review comments use, and everything else stays literal text, HTML included: the page builds
// elements from these, never HTML from the body.

/**
 * A run of text in a paragraph: plain, a code span, emphasis, a link, or an image or video, whose
 * `text` is its alt text. A medium's `url` is where the host keeps it, null when it isn't in the
 * host's own store and so is never fetched. A link's `url` is null unless it's http(s), so no other
 * scheme becomes a link.
 */
export type Span =
  | { readonly kind: "text" | "code"; readonly text: string }
  | { readonly kind: "strong" | "emphasis" | "strike"; readonly spans: readonly Span[] }
  | { readonly kind: "link"; readonly url: string | null; readonly spans: readonly Span[] }
  | {
      readonly kind: "image" | "video";
      readonly text: string;
      readonly url: string | null;
      /** The size the host gave it, so the page can keep its place before it loads. */
      readonly size?: { readonly width: number; readonly height: number };
    };

export interface ListItem {
  /** A task list item's box: true when ticked, null for an item that isn't a task. */
  readonly checked: boolean | null;
  readonly blocks: readonly BodyBlock[];
}

export type TableAlign = "left" | "center" | "right" | null;

export type BodyBlock =
  | { readonly kind: "paragraph"; readonly spans: readonly Span[] }
  | { readonly kind: "heading"; readonly level: number; readonly spans: readonly Span[] }
  /** A fenced code block; `language` is its info string's first word, or null. */
  | { readonly kind: "code"; readonly language: string | null; readonly text: string }
  /** A ```suggestion block: the lines that replace the ones the comment covers. */
  | { readonly kind: "suggestion"; readonly lines: readonly string[] }
  | { readonly kind: "quote"; readonly blocks: readonly BodyBlock[] }
  | {
      readonly kind: "list";
      readonly ordered: boolean;
      /** The first item's number; 1 for a bulleted list. */
      readonly start: number;
      readonly items: readonly ListItem[];
    }
  | {
      readonly kind: "table";
      readonly align: readonly TableAlign[];
      readonly head: readonly (readonly Span[])[];
      readonly rows: readonly (readonly (readonly Span[])[])[];
    }
  | { readonly kind: "rule" };

export interface ParsedBody {
  readonly blocks: readonly BodyBlock[];
}

/** How deep quotes, lists and emphasis nest before the rest is read as text. */
const MAX_DEPTH = 8;
/** How far a link's text may run looking for its `]`, so `[[[[…` stays linear. */
const MAX_LINK_TEXT = 500;

const PUNCTUATION = /^[!-/:-@[-`{-~]$/;
const WHITESPACE = /^\s$/;
const WORD = /^[\p{L}\p{N}]$/u;
const isWhitespace = (char: string | undefined) => char === undefined || WHITESPACE.test(char);
const isWord = (char: string | undefined) => char !== undefined && WORD.test(char);

const runLength = (text: string, at: number, char: string): number => {
  let end = at;
  while (text[end] === char) end += 1;
  return end - at;
};

const ENTITY = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|(amp|lt|gt|quot|apos|nbsp));/y;
const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

const codePoint = (value: number): string =>
  value === 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)
    ? "�"
    : String.fromCodePoint(value);

/** Text with its backslash escapes and entities read, as a link's URL or an image's alt. */
const literalOf = (text: string): string =>
  text
    .replace(/\\([!-/:-@[-`{-~])/g, "$1")
    .replace(
      /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|(amp|lt|gt|quot|apos|nbsp));/g,
      (_, dec, hex, name) =>
        name !== undefined
          ? (NAMED[name] ?? "")
          : codePoint(dec !== undefined ? Number(dec) : Number.parseInt(hex, 16)),
    );

const ALT = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const SRC = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const WIDTH = /\bwidth\s*=\s*["']?(\d{1,5})["']?/i;
const HEIGHT = /\bheight\s*=\s*["']?(\d{1,5})["']?/i;
const IMG_TAG = /<img\b[^>]*>/iy;
const AUTOLINK = /<(https?:\/\/[^\s<>]*)>/iy;
const BARE_URL = /https?:\/\/[^\s<]+/iy;
/** Bitbucket's editor writes `{: data-inline-card='' }` after a link it shows as a card. */
const ATTRIBUTES = /\{:[^}\n]*\}/y;
const GITHUB_ASSET = /^https:\/\/github\.com\/user-attachments\/assets\/[0-9a-f-]+$/i;

/** An `<img>` tag's width and height, when it gives both. */
const sizeOf = (tag: string): { width: number; height: number } | undefined => {
  const width = Number(WIDTH.exec(tag)?.[1] ?? 0);
  const height = Number(HEIGHT.exec(tag)?.[1] ?? 0);
  return width > 0 && height > 0 ? { width, height } : undefined;
};

const quoted = (pattern: RegExp, tag: string): string | undefined =>
  pattern
    .exec(tag)
    ?.slice(1)
    .find((one) => one !== undefined);

/** A media span, its URL kept only when the host's own store has it. */
const media = (
  kind: "image" | "video",
  alt: string,
  url: string | undefined,
): Extract<Span, { kind: "image" | "video" }> => ({
  kind,
  text: alt.trim(),
  url: url !== undefined && attachmentHost(url) !== null ? url : null,
});

/** A link's URL when it's one the page may open: http(s) only. */
const linkUrl = (raw: string): string | null => {
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    return new URL(raw).href;
  } catch {
    return null;
  }
};

/** The end of a bare URL: without the punctuation that ends its sentence or closes a bracket. */
const trimUrl = (url: string): string => {
  let end = url.length;
  for (;;) {
    const last = url[end - 1];
    if (last !== undefined && "?!.,:;*_~'\"".includes(last)) end -= 1;
    else if (last === ")") {
      const inside = url.slice(0, end);
      if ((inside.match(/\(/g)?.length ?? 0) < (inside.match(/\)/g)?.length ?? 0)) end -= 1;
      else break;
    } else break;
  }
  return url.slice(0, end);
};

interface Destination {
  readonly url: string;
  /** Where the link ends, after its `)`. */
  readonly end: number;
}

/** A link's `(destination "title")` starting at `at`, which is its `(`. */
const destinationAt = (text: string, at: number): Destination | null => {
  if (text[at] !== "(") return null;
  let index = at + 1;
  while (text[index] === " " || text[index] === "\t") index += 1;
  let url = "";
  if (text[index] === "<") {
    const close = text.indexOf(">", index);
    if (close === -1 || text.slice(index, close).includes("\n")) return null;
    url = text.slice(index + 1, close);
    index = close + 1;
  } else {
    const start = index;
    let depth = 0;
    while (index < text.length) {
      const char = text[index] ?? "";
      if (char === "\\" && PUNCTUATION.test(text[index + 1] ?? "")) index += 2;
      else if (WHITESPACE.test(char)) break;
      else if (char === "(") {
        depth += 1;
        index += 1;
      } else if (char === ")") {
        if (depth === 0) break;
        depth -= 1;
        index += 1;
      } else index += 1;
    }
    url = text.slice(start, index);
  }
  while (text[index] === " " || text[index] === "\t") index += 1;
  const opener = text[index];
  if (opener === '"' || opener === "'" || (opener === "(" && url !== "")) {
    const closer = opener === "(" ? ")" : opener;
    const close = text.indexOf(closer, index + 1);
    if (close === -1) return null;
    index = close + 1;
    while (text[index] === " " || text[index] === "\t") index += 1;
  }
  return text[index] === ")" ? { url: literalOf(url), end: index + 1 } : null;
};

/** Reads one paragraph's text into spans. Each instance reads one string once. */
class InlineReader {
  /** Per run length of backticks, a position from which no closing run follows. */
  private readonly noCode = new Map<number, number>();
  /** Per delimiter and length, a position from which no closing run follows. */
  private readonly noCloser = new Map<string, number>();
  private readonly spans: Span[] = [];
  private plain = "";
  private readonly text: string;
  private readonly depth: number;
  private readonly inLink: boolean;

  constructor(text: string, depth: number, inLink: boolean) {
    this.text = text;
    this.depth = depth;
    this.inLink = inLink;
  }

  read(): Span[] {
    const { text } = this;
    let at = 0;
    while (at < text.length) at = this.step(at);
    this.flush();
    return this.spans;
  }

  private flush() {
    if (this.plain !== "") this.spans.push({ kind: "text", text: this.plain });
    this.plain = "";
  }

  private push(span: Span) {
    this.flush();
    this.spans.push(span);
  }

  private nested(text: string, inLink = this.inLink): Span[] {
    return new InlineReader(text, this.depth + 1, inLink).read();
  }

  /** Reads what starts at `at` and returns where the next thing starts. */
  private step(at: number): number {
    const { text } = this;
    const char = text[at] ?? "";
    if (char === "\\") {
      const next = text[at + 1];
      if (next === "\n" || (next !== undefined && PUNCTUATION.test(next))) {
        this.plain += next;
        return at + 2;
      }
    }
    if (char === "`") {
      const code = this.codeAt(at);
      if (code !== null) {
        this.push({ kind: "code", text: code.text });
        return code.end;
      }
      const run = runLength(text, at, "`");
      this.plain += "`".repeat(run);
      return at + run;
    }
    if (char === "&") {
      ENTITY.lastIndex = at;
      const entity = ENTITY.exec(text);
      if (entity !== null) {
        const [whole, dec, hex, name] = entity;
        this.plain +=
          name !== undefined
            ? (NAMED[name] ?? "")
            : codePoint(dec !== undefined ? Number(dec) : Number.parseInt(hex ?? "0", 16));
        return at + whole.length;
      }
    }
    if (char === "<") {
      const end = this.angleAt(at);
      if (end !== null) return end;
    }
    if (char === "!" && text[at + 1] === "[") {
      const end = this.linkAt(at + 1, true);
      if (end !== null) return end;
    }
    if (char === "[" && !this.inLink) {
      const end = this.linkAt(at, false);
      if (end !== null) return end;
    }
    if ((char === "h" || char === "H") && !this.inLink) {
      const end = this.bareUrlAt(at);
      if (end !== null) return end;
    }
    if ((char === "*" || char === "_" || char === "~") && this.depth < MAX_DEPTH) {
      const end = this.emphasisAt(at, char);
      if (end !== null) return end;
      const run = runLength(text, at, char);
      this.plain += char.repeat(run);
      return at + run;
    }
    this.plain += char;
    return at + 1;
  }

  /** The code span opening at `at`: a run of backticks up to the next run of the same length. */
  private codeAt(at: number): { readonly end: number; readonly text: string } | null {
    const { text } = this;
    const run = runLength(text, at, "`");
    const from = at + run;
    if (from >= (this.noCode.get(run) ?? Number.POSITIVE_INFINITY)) return null;
    let search = from;
    for (;;) {
      const found = text.indexOf("`", search);
      if (found === -1) {
        this.noCode.set(run, from);
        return null;
      }
      const length = runLength(text, found, "`");
      if (length === run) {
        const inner = text.slice(from, found);
        // One space on each side is padding, so a span can start or end with a backtick.
        const padded = inner.length > 2 && inner.startsWith(" ") && inner.endsWith(" ");
        return { end: found + run, text: padded ? inner.slice(1, -1) : inner };
      }
      search = found + length;
    }
  }

  /** An `<img>` tag or an autolink at `at`; any other `<` is text. */
  private angleAt(at: number): number | null {
    const { text } = this;
    IMG_TAG.lastIndex = at;
    const tag = IMG_TAG.exec(text)?.[0];
    if (tag !== undefined) {
      const image = media("image", quoted(ALT, tag) ?? "", quoted(SRC, tag));
      const size = sizeOf(tag);
      this.push(size === undefined ? image : { ...image, size });
      return at + tag.length;
    }
    if (this.inLink) return null;
    AUTOLINK.lastIndex = at;
    const autolink = AUTOLINK.exec(text);
    if (autolink === null) return null;
    const [whole, url = ""] = autolink;
    this.push({ kind: "link", url: linkUrl(url), spans: [{ kind: "text", text: url }] });
    return at + whole.length;
  }

  /** A `[text](url)` link, or with `image` a `![alt](url)` image, whose `[` is at `at`. */
  private linkAt(at: number, image: boolean): number | null {
    const { text } = this;
    let depth = 0;
    let index = at;
    const limit = Math.min(text.length, at + MAX_LINK_TEXT);
    let close = -1;
    while (index < limit) {
      const char = text[index];
      if (char === "\\") index += 2;
      else if (char === "`") {
        const code = this.codeAt(index);
        index = code === null ? index + runLength(text, index, "`") : code.end;
      } else {
        if (char === "[") depth += 1;
        else if (char === "]") {
          depth -= 1;
          if (depth === 0) {
            close = index;
            break;
          }
        }
        index += 1;
      }
    }
    if (close === -1) return null;
    const destination = destinationAt(text, close + 1);
    if (destination === null) return null;
    const label = text.slice(at + 1, close);
    let end = destination.end;
    ATTRIBUTES.lastIndex = end;
    const attributes = ATTRIBUTES.exec(text);
    if (attributes !== null) end += attributes[0].length;
    if (image) {
      this.push(media("image", literalOf(label), destination.url));
    } else {
      this.push({
        kind: "link",
        url: linkUrl(destination.url),
        spans: this.depth < MAX_DEPTH ? this.nested(label, true) : [{ kind: "text", text: label }],
      });
    }
    return end;
  }

  /**
   * A bare http(s) URL, as GitHub and Bitbucket link them. A GitHub attachment alone on its line
   * is a video, as GitHub pastes one.
   */
  private bareUrlAt(at: number): number | null {
    const { text } = this;
    const before = text[at - 1];
    if (before !== undefined && !/[\s(*_~]/.test(before)) return null;
    BARE_URL.lastIndex = at;
    const match = BARE_URL.exec(text)?.[0];
    if (match === undefined) return null;
    const url = trimUrl(match);
    if (!/^https?:\/\/[^/]/i.test(url)) return null;
    const end = at + url.length;
    const lineStart = text.lastIndexOf("\n", at - 1) + 1;
    const lineEnd = text.indexOf("\n", end);
    const alone =
      text.slice(lineStart, at).trim() === "" &&
      text.slice(end, lineEnd === -1 ? text.length : lineEnd).trim() === "";
    if (alone && GITHUB_ASSET.test(url)) this.push(media("video", "", url));
    else this.push({ kind: "link", url: linkUrl(url), spans: [{ kind: "text", text: url }] });
    return end;
  }

  /**
   * `*em*`, `**strong**`, `***both***`, the same with `_` outside words, and `~~strike~~`. An
   * opening run is followed by a non-space and closed by a run of the same length after a
   * non-space; one that never closes is text.
   */
  private emphasisAt(at: number, char: string): number | null {
    const { text } = this;
    const run = runLength(text, at, char);
    const maxRun = char === "~" ? 2 : 3;
    if (run > maxRun || isWhitespace(text[at + run])) return null;
    if (char === "_" && isWord(text[at - 1])) return null;
    const from = at + run;
    const key = `${char}${run}`;
    if (from >= (this.noCloser.get(key) ?? Number.POSITIVE_INFINITY)) return null;
    let index = from;
    let close = -1;
    while (index < text.length) {
      const current = text[index];
      if (current === "\\") index += 2;
      else if (current === "`") {
        const code = this.codeAt(index);
        index = code === null ? index + runLength(text, index, "`") : code.end;
      } else if (current === char) {
        const length = runLength(text, index, char);
        const closes =
          length === run &&
          index > from &&
          !isWhitespace(text[index - 1]) &&
          !(char === "_" && isWord(text[index + length]));
        if (closes) {
          close = index;
          break;
        }
        index += length;
      } else index += 1;
    }
    if (close === -1) {
      this.noCloser.set(key, from);
      return null;
    }
    const inner = this.nested(text.slice(from, close));
    if (char === "~") this.push({ kind: "strike", spans: inner });
    else if (run === 1) this.push({ kind: "emphasis", spans: inner });
    else if (run === 2) this.push({ kind: "strong", spans: inner });
    else this.push({ kind: "strong", spans: [{ kind: "emphasis", spans: inner }] });
    return close + run;
  }
}

/** A paragraph's spans: code spans, emphasis, links, images and videos; the rest is text. */
export const parseSpans = (text: string): Span[] => new InlineReader(text, 0, false).read();

/** A span's text as it reads, without its markers. */
const plainOf = (spans: readonly Span[]): string =>
  spans.map((span) => ("spans" in span ? plainOf(span.spans) : span.text)).join("");

/** A block's text as it reads, without its markers, for a one-line preview. */
const blockText = (block: BodyBlock): string => {
  switch (block.kind) {
    case "paragraph":
    case "heading":
      return plainOf(block.spans);
    case "code":
      return block.text;
    case "suggestion":
      return "Suggested change";
    case "quote":
      return block.blocks.map(blockText).find((text) => text.trim() !== "") ?? "";
    case "list":
      return block.items[0]?.blocks.map(blockText).find((text) => text.trim() !== "") ?? "";
    case "table":
      return block.head.map(plainOf).join(" | ");
    case "rule":
      return "";
  }
};

/** A body's first line as it reads, without Markdown's markers: a folded thread's preview. */
export const previewOf = (body: string): string => {
  for (const block of parseBlocks(body)) {
    const line = blockText(block).split("\n")[0]?.trim() ?? "";
    if (line !== "") return line;
  }
  return "";
};

// Block structure. Indentation counts spaces; a tab counts as one.

/** Blank, or holding only invisible characters, as Bitbucket's editor leaves some lines. */
const isBlank = (line: string) => /^[\s​-‍⁠﻿]*$/.test(line);
const indentOf = (line: string) => /^ */.exec(line)?.[0].length ?? 0;

/** An opening fence: its indent, backticks and info string. Tildes and indented code aren't read. */
const OPENING = /^( {0,3})(`{3,})([^`]*)$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
const RULE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*))?$/;
const TASK = /^\[([ xX])\](?:[ \t]+|$)/;
const DELIMITER_CELL = /^:?-+:?$/;

interface ItemStart {
  readonly ordered: boolean;
  /** The bullet, or an ordered item's `.` or `)`. */
  readonly delimiter: string;
  readonly number: number;
  /** Where the item's content starts: lines indented this far continue it. */
  readonly contentIndent: number;
  readonly content: string;
}

const itemAt = (line: string): ItemStart | null => {
  const match = ITEM.exec(line);
  if (match === null) return null;
  const [, indent = "", marker = "", spaces = "", content = ""] = match;
  const ordered = /\d/.test(marker);
  // Five spaces or more after the marker are one, and the rest is the content's own.
  const gap = spaces.length > 4 ? 1 : spaces.length;
  return {
    ordered,
    delimiter: ordered ? marker.slice(-1) : marker,
    number: ordered ? Number(marker.slice(0, -1)) : 1,
    contentIndent: indent.length + marker.length + Math.max(gap, 1),
    content: spaces.length > 4 ? `${spaces.slice(1)}${content}` : content,
  };
};

const sameList = (a: ItemStart, b: ItemStart) =>
  a.ordered === b.ordered && a.delimiter === b.delimiter;

/** A table row's cells, split on pipes that aren't escaped. */
const cellsOf = (line: string): string[] => {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  for (let at = 0; at < row.length; at += 1) {
    const char = row[at] ?? "";
    if (char === "\\" && row[at + 1] === "|") {
      cell += "\\|";
      at += 1;
    } else if (char === "|") {
      cells.push(cell.trim());
      cell = "";
    } else cell += char;
  }
  cells.push(cell.trim());
  return cells;
};

/** A table's columns' alignment, when `line` is the row under its header, or null. */
const delimiterRow = (line: string, columns: number): TableAlign[] | null => {
  if (!line.includes("-")) return null;
  const cells = cellsOf(line);
  if (cells.length !== columns || !cells.every((cell) => DELIMITER_CELL.test(cell))) return null;
  return cells.map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    return left && right ? "center" : left ? "left" : right ? "right" : null;
  });
};

/** Reads lines into blocks. Suggestions are read only at the top, never quoted or in a list. */
class BlockReader {
  /** Lines that can close a fence, by index, with their run's length. */
  private readonly closings: { readonly index: number; readonly length: number }[] = [];
  private readonly lines: readonly string[];
  private readonly depth: number;

  constructor(lines: readonly string[], depth: number) {
    this.lines = lines;
    this.depth = depth;
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (/^`{3,}$/.test(trimmed) && indentOf(line) <= 3) {
        this.closings.push({ index, length: trimmed.length });
      }
    });
  }

  /** The line closing a fence of `length` opened at `at`, or -1. */
  private closeOf(at: number, length: number): number {
    return this.closings.find((one) => one.index > at && one.length >= length)?.index ?? -1;
  }

  private fenceAt(
    at: number,
  ): { readonly close: number; readonly opening: RegExpExecArray } | null {
    const opening = OPENING.exec(this.lines[at] ?? "");
    if (opening === null) return null;
    const close = this.closeOf(at, opening[2]?.length ?? 3);
    return close === -1 ? null : { close, opening };
  }

  private tableAt(at: number): TableAlign[] | null {
    const line = this.lines[at] ?? "";
    const next = this.lines[at + 1];
    if (!line.includes("|") || next === undefined) return null;
    return delimiterRow(next, cellsOf(line).length);
  }

  /** Whether the line at `at` starts a block, which ends a paragraph before it. */
  private interrupts(at: number): boolean {
    const line = this.lines[at] ?? "";
    if (isBlank(line) || HEADING.test(line) || RULE.test(line)) return true;
    if (this.fenceAt(at) !== null || this.tableAt(at) !== null) return true;
    if (this.depth >= MAX_DEPTH) return false;
    if (QUOTE.test(line)) return true;
    const item = itemAt(line);
    // As in CommonMark, only a bullet or a list from 1, with content, breaks a paragraph.
    return item !== null && item.content.trim() !== "" && (!item.ordered || item.number === 1);
  }

  read(): BodyBlock[] {
    const { lines } = this;
    const blocks: BodyBlock[] = [];
    let paragraph: string[] = [];
    const endParagraph = () => {
      const text = paragraph.join("\n").trim();
      if (text !== "") blocks.push({ kind: "paragraph", spans: parseSpans(text) });
      paragraph = [];
    };
    let at = 0;
    while (at < lines.length) {
      const line = lines[at] ?? "";
      if (paragraph.length > 0 && !this.interrupts(at)) {
        paragraph.push(line.trimEnd());
        at += 1;
        continue;
      }
      if (isBlank(line)) {
        endParagraph();
        at += 1;
        continue;
      }
      endParagraph();
      const next = this.blockAt(at, blocks);
      if (next !== null) {
        at = next;
        continue;
      }
      paragraph.push(line.trimEnd());
      at += 1;
    }
    endParagraph();
    return blocks;
  }

  /** Reads the block starting at `at` into `blocks` and returns where the next starts, or null. */
  private blockAt(at: number, blocks: BodyBlock[]): number | null {
    const line = this.lines[at] ?? "";
    const fence = this.fenceAt(at);
    if (fence !== null) {
      blocks.push(this.fenced(at, fence.close, fence.opening));
      return fence.close + 1;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      const content = (heading[2] ?? "").replace(/(?:^|[ \t]+)#+[ \t]*$/, "").trim();
      blocks.push({ kind: "heading", level: heading[1]?.length ?? 1, spans: parseSpans(content) });
      return at + 1;
    }
    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      return at + 1;
    }
    const align = this.tableAt(at);
    if (align !== null) return this.table(at, align, blocks);
    if (this.depth >= MAX_DEPTH) return null;
    if (QUOTE.test(line)) return this.quote(at, blocks);
    const item = itemAt(line);
    if (item !== null) return this.list(at, item, blocks);
    return null;
  }

  private fenced(at: number, close: number, opening: RegExpExecArray): BodyBlock {
    const indent = opening[1]?.length ?? 0;
    const fence = opening[2] ?? "";
    const info = (opening[3] ?? "").trim();
    // A fence indented inside a list item takes its indent off its lines.
    const content = this.lines
      .slice(at + 1, close)
      .map((inner) => inner.slice(Math.min(indent, indentOf(inner))));
    const language = info.split(/\s+/)[0] ?? "";
    const nested = content.some((inner) => {
      const run = /^`{3,}/.exec(inner)?.[0];
      return run !== undefined && run.length === fence.length;
    });
    if (language === "suggestion" && !nested && this.depth === 0) {
      return { kind: "suggestion", lines: content };
    }
    return {
      kind: "code",
      language: language === "" || language === "suggestion" ? null : language,
      text: content.join("\n"),
    };
  }

  private nested(lines: readonly string[]): BodyBlock[] {
    return new BlockReader(lines, this.depth + 1).read();
  }

  /** Lines that start with `>`, and those after them that only continue their paragraph. */
  private quote(at: number, blocks: BodyBlock[]): number {
    const inner: string[] = [];
    let index = at;
    while (index < this.lines.length) {
      const line = this.lines[index] ?? "";
      const quoted = QUOTE.exec(line);
      if (quoted !== null) inner.push(quoted[1] ?? "");
      else if (!isBlank(inner.at(-1) ?? "") && !this.interrupts(index)) inner.push(line);
      else break;
      index += 1;
    }
    blocks.push({ kind: "quote", blocks: this.nested(inner) });
    return index;
  }

  /**
   * Items of one kind in a row. An item holds the lines indented to its content, blank lines
   * between them, and lines that only continue its paragraph.
   */
  private list(at: number, first: ItemStart, blocks: BodyBlock[]): number {
    const { lines } = this;
    const items: ListItem[] = [];
    let index = at;
    let item: ItemStart | null = first;
    while (item !== null) {
      const content = [item.content];
      index += 1;
      while (index < lines.length) {
        const line = lines[index] ?? "";
        if (isBlank(line)) {
          let next = index;
          while (next < lines.length && isBlank(lines[next] ?? "")) next += 1;
          if (next < lines.length && indentOf(lines[next] ?? "") >= item.contentIndent) {
            for (; index < next; index += 1) content.push("");
            continue;
          }
          break;
        }
        if (indentOf(line) >= item.contentIndent) content.push(line.slice(item.contentIndent));
        else if (
          !isBlank(content.at(-1) ?? "") &&
          !this.interrupts(index) &&
          itemAt(line) === null
        ) {
          content.push(line.trimStart());
        } else break;
        index += 1;
      }
      const [head = "", ...rest] = content;
      const task = TASK.exec(head);
      items.push({
        checked: task === null ? null : task[1] !== " ",
        blocks: this.nested([task === null ? head : head.slice(task[0].length), ...rest]),
      });
      let next = index;
      while (next < lines.length && isBlank(lines[next] ?? "")) next += 1;
      const following = next < lines.length ? itemAt(lines[next] ?? "") : null;
      if (following !== null && sameList(first, following)) {
        index = next;
        item = following;
      } else item = null;
    }
    blocks.push({ kind: "list", ordered: first.ordered, start: first.number, items });
    return index;
  }

  /** A header row, the row under it, and rows up to a blank line or another block. */
  private table(at: number, align: readonly TableAlign[], blocks: BodyBlock[]): number {
    const columns = align.length;
    const row = (line: string) => {
      const cells = cellsOf(line).slice(0, columns);
      while (cells.length < columns) cells.push("");
      return cells.map(parseSpans);
    };
    const rows: Span[][][] = [];
    let index = at + 2;
    while (index < this.lines.length && !this.interrupts(index)) {
      rows.push(row(this.lines[index] ?? ""));
      index += 1;
    }
    blocks.push({ kind: "table", align, head: row(this.lines[at] ?? ""), rows });
    return index;
  }
}

/**
 * A body's blocks: paragraphs, headings, quotes, lists, tables, rules and fenced code. A fence
 * that never closes is text. A suggestion whose lines would open or close a fence of its length
 * is shown as code and never applied, since where it ends is a guess.
 */
export const parseBlocks = (body: string): BodyBlock[] =>
  new BlockReader(body.replaceAll("\r\n", "\n").split("\n"), 0).read();

/** A body read for showing, as its blocks. */
export const parseBody = (body: string): ParsedBody => ({ blocks: parseBlocks(body) });

/** The suggestion a body makes, or null without exactly one well-formed block. */
export const suggestionOf = (body: string): readonly string[] | null => {
  const suggestions = parseBody(body).blocks.filter((block) => block.kind === "suggestion");
  const [only] = suggestions;
  return suggestions.length === 1 && only !== undefined ? only.lines : null;
};

/** A fence longer than any run of backticks starting a line, so the lines can't close it. */
const fenceFor = (lines: readonly string[]): string => {
  const longest = Math.max(2, ...lines.map((line) => /^`*/.exec(line)?.[0].length ?? 0));
  return "`".repeat(longest + 1);
};

/**
 * A comment's body as it's posted: the text, then the suggestion as a ```suggestion block, which
 * GitHub renders as one.
 */
export const composeBody = (input: {
  readonly body: string;
  readonly suggestion?: readonly string[] | null | undefined;
}): string => {
  const head = input.body.trim();
  if (input.suggestion == null) return head;
  const fence = fenceFor(input.suggestion);
  const block = [`${fence}suggestion`, ...input.suggestion, fence].join("\n");
  return head === "" ? block : `${head}\n\n${block}`;
};
