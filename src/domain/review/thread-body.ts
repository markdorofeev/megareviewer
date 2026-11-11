import { err, ok, type Result } from "../shared/index.ts";
import { attachmentHost } from "./attachments.ts";
import { Severity } from "./thread.ts";

// A comment body is untrusted host content. It's read into a few kinds of block, and everything
// else stays literal text: no HTML, no links, no images.

/**
 * A run of text in a paragraph: plain, a code span, or an image or video, whose `text` is its alt
 * text. `url` is where the host keeps it, null when it isn't in the host's own store and so is
 * never fetched.
 */
export type Span =
  | { readonly kind: "text" | "code"; readonly text: string }
  | {
      readonly kind: "image" | "video";
      readonly text: string;
      readonly url: string | null;
    };

/**
 * An image as hosts paste one, an HTML `<img>` tag or Markdown's `![alt](url)`, or a video as
 * GitHub pastes one: its attachment's URL alone on a line.
 */
const MEDIA =
  /<img\b[^>]*>|!\[([^\]\n]*)\]\(([^)\s]*)\)|(?<=^|\n)[ \t]*(https:\/\/github\.com\/user-attachments\/assets\/[0-9a-f-]+)[ \t]*(?=\n|$)/gi;
const ALT = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const SRC = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

const quoted = (pattern: RegExp, tag: string): string | undefined =>
  pattern
    .exec(tag)
    ?.slice(1)
    .find((one) => one !== undefined);

/** A media span, its URL kept only when the host's own store has it. */
const media = (kind: "image" | "video", alt: string, url: string | undefined): Span => ({
  kind,
  text: alt.trim(),
  url: url !== undefined && attachmentHost(url) !== null ? url : null,
});

/**
 * A text span's images and videos as spans of their own. The page shows those the host keeps,
 * through the local server, and only names the others.
 */
const withImages = (text: string): Span[] => {
  const spans: Span[] = [];
  let at = 0;
  for (const match of text.matchAll(MEDIA)) {
    const index = match.index ?? 0;
    if (index > at) spans.push({ kind: "text", text: text.slice(at, index) });
    const [whole, markdownAlt, markdownUrl, videoUrl] = match;
    if (videoUrl !== undefined) spans.push(media("video", "", videoUrl));
    else if (whole.startsWith("<")) {
      spans.push(media("image", quoted(ALT, whole) ?? "", quoted(SRC, whole)));
    } else spans.push(media("image", markdownAlt ?? "", markdownUrl));
    at = index + whole.length;
  }
  if (at < text.length) spans.push({ kind: "text", text: text.slice(at) });
  return spans;
};

export type BodyBlock =
  | { readonly kind: "paragraph"; readonly spans: readonly Span[] }
  /** A fenced code block; `language` is its info string's first word, or null. */
  | { readonly kind: "code"; readonly language: string | null; readonly text: string }
  /** A ```suggestion block: the lines that replace the ones the comment covers. */
  | { readonly kind: "suggestion"; readonly lines: readonly string[] };

export interface ParsedBody {
  readonly severity: Severity | null;
  readonly blocks: readonly BodyBlock[];
}

const SEVERITY_PREFIX = /^\*\*(minor|major|blocking):\*\*(?:[ \t]+|\n|$)/;

/**
 * The severity a body starts with, exactly as megareviewer writes it (`**major:** …`), and the
 * rest. Any other text, `**Major:**` or `major:` among them, has no severity: one is never guessed.
 */
export const splitSeverity = (body: string): { severity: Severity | null; rest: string } => {
  const match = SEVERITY_PREFIX.exec(body);
  const level = Severity.safeParse(match?.[1]);
  if (match === null || !level.success) return { severity: null, rest: body };
  return { severity: level.data, rest: body.slice(match[0].length) };
};

/** An opening fence: its backticks and info string. Tildes and indented fences aren't read. */
const OPENING = /^(`{3,})([^`]*)$/;

const isClosing = (line: string, fence: string): boolean => {
  const trimmed = line.trimEnd();
  return /^`+$/.test(trimmed) && trimmed.length >= fence.length;
};

/** Code spans in a paragraph: a run of backticks up to the next run of the same length. */
export const parseSpans = (text: string): Span[] => {
  const spans: Span[] = [];
  let plain = "";
  let at = 0;
  while (at < text.length) {
    const run = /^`+/.exec(text.slice(at))?.[0];
    if (run === undefined) {
      plain += text[at];
      at += 1;
      continue;
    }
    // The closing run must be exactly as long, not part of a longer one.
    const closing = new RegExp(`(?<!\`)${run}(?!\`)`, "g");
    closing.lastIndex = at + run.length;
    const found = closing.exec(text);
    if (found === null) {
      plain += run;
      at += run.length;
      continue;
    }
    if (plain !== "") spans.push(...withImages(plain));
    plain = "";
    const inner = text.slice(at + run.length, found.index);
    // One space on each side is padding, so a span can start or end with a backtick.
    const padded = inner.length > 2 && inner.startsWith(" ") && inner.endsWith(" ");
    spans.push({ kind: "code", text: padded ? inner.slice(1, -1) : inner });
    at = found.index + run.length;
  }
  if (plain !== "") spans.push(...withImages(plain));
  return spans;
};

/**
 * A body's blocks: paragraphs split by blank lines, and fenced blocks. A fence that never closes
 * is text. A suggestion whose lines would open or close a fence of its length is shown as code
 * and never applied, since where it ends is a guess.
 */
export const parseBlocks = (body: string): BodyBlock[] => {
  const lines = body.replaceAll("\r\n", "\n").split("\n");
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
    const opening = OPENING.exec(line);
    const closeAt =
      opening?.[1] === undefined
        ? -1
        : lines.findIndex((other, index) => index > at && isClosing(other, opening[1] ?? ""));
    if (opening === null || closeAt === -1) {
      if (line.trim() === "") endParagraph();
      else paragraph.push(line);
      at += 1;
      continue;
    }
    endParagraph();
    const fence = opening[1] ?? "";
    const info = (opening[2] ?? "").trim();
    const content = lines.slice(at + 1, closeAt);
    const language = info.split(/\s+/)[0] ?? "";
    const nested = content.some((inner) => {
      const run = /^`{3,}/.exec(inner)?.[0];
      return run !== undefined && run.length === fence.length;
    });
    if (language === "suggestion" && !nested) {
      blocks.push({ kind: "suggestion", lines: content });
    } else {
      blocks.push({
        kind: "code",
        language: language === "" || language === "suggestion" ? null : language,
        text: content.join("\n"),
      });
    }
    at = closeAt + 1;
  }
  endParagraph();
  return blocks;
};

/** A body read for showing: its severity, then its blocks. */
export const parseBody = (body: string): ParsedBody => {
  const { severity, rest } = splitSeverity(body);
  return { severity, blocks: parseBlocks(rest) };
};

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
 * A comment's body as it's posted: its severity first, as `**major:**`, then the text, then the
 * suggestion as a ```suggestion block, which GitHub renders as one.
 */
export const composeBody = (input: {
  readonly body: string;
  readonly severity?: Severity | null | undefined;
  readonly suggestion?: readonly string[] | null | undefined;
}): string => {
  const text = input.body.trim();
  const head = input.severity == null ? text : `**${input.severity}:** ${text}`.trimEnd();
  if (input.suggestion == null) return head;
  const fence = fenceFor(input.suggestion);
  const block = [`${fence}suggestion`, ...input.suggestion, fence].join("\n");
  return head === "" ? block : `${head}\n\n${block}`;
};

/** Lines `start` to `end`, 1-based and inclusive, replaced by `lines`. */
export interface LineEdit {
  readonly start: number;
  readonly end: number;
  readonly lines: readonly string[];
}

export const editsOverlap = (
  a: Pick<LineEdit, "start" | "end">,
  b: Pick<LineEdit, "start" | "end">,
) => a.start <= b.end && b.start <= a.end;

export type EditProblem =
  | { readonly kind: "overlap"; readonly at: number }
  | { readonly kind: "out-of-range"; readonly at: number };

/**
 * A file's content with every edit made. Edits are on the content's own line numbers, so they're
 * made from the last up; two that overlap can't both be made, and the second is refused. The
 * file's line ending and its final newline are kept.
 */
export const applyEdits = (
  content: string,
  edits: readonly LineEdit[],
): Result<string, EditProblem> => {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const endsWithNewline = content.endsWith(newline);
  const lines = content.split(newline);
  if (endsWithNewline) lines.pop();
  for (const [at, edit] of edits.entries()) {
    if (edit.start < 1 || edit.end < edit.start || edit.end > lines.length) {
      return err({ kind: "out-of-range", at });
    }
    if (edits.slice(0, at).some((earlier) => editsOverlap(earlier, edit))) {
      return err({ kind: "overlap", at });
    }
  }
  const ordered = [...edits].sort((a, b) => b.start - a.start);
  for (const edit of ordered)
    lines.splice(edit.start - 1, edit.end - edit.start + 1, ...edit.lines);
  const joined = lines.join(newline);
  return ok(endsWithNewline && lines.length > 0 ? joined + newline : joined);
};
