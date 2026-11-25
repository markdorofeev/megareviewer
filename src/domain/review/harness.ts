import { z } from "zod";
import { GUIDELINE_PATHS, guidelineEnabled, MAX_INLINE_BYTES } from "./preference.ts";
import { Sha } from "./primitives.ts";

/** Git's own hash of a file's content, which names it whatever commit or path it's at. */
export const BlobHash = z.string().regex(/^[0-9a-f]{40}$/);
export type BlobHash = z.infer<typeof BlobHash>;

/** How a file names another: `@path`, a Markdown link, or a path in prose. Strongest first. */
export const HarnessLinkKind = z.enum(["import", "link", "mention"]);
export type HarnessLinkKind = z.infer<typeof HarnessLinkKind>;

export const HarnessHeading = z
  .object({
    level: z.number().int().min(1).max(6),
    text: z.string(),
    line: z.number().int().positive(),
  })
  .readonly();
export type HarnessHeading = z.infer<typeof HarnessHeading>;

/** A guideline file, or a file one of them reaches, at a PR's base commit. */
export const HarnessFile = z
  .object({
    path: z.string().min(1),
    blob: BlobHash,
    bytes: z.number().int().nonnegative(),
    lines: z.number().int().nonnegative(),
    /** The strongest kind any file links it by. */
    via: z.enum(["root", ...HarnessLinkKind.options]),
    /** The first file found linking it; null for a root. */
    linkedFrom: z.string().nullable(),
    headings: z.array(HarnessHeading).readonly(),
    /** The harness's files this one links, in the order it does, each by its strongest kind. */
    links: z.array(z.object({ path: z.string(), kind: HarnessLinkKind }).readonly()).readonly(),
  })
  .readonly();
export type HarnessFile = z.infer<typeof HarnessFile>;

/** too-large: over MAX_HARNESS_FILE_BYTES. unreadable: there, but not as text the host serves. */
export const HarnessSkipReason = z.enum(["too-large", "unreadable"]);
export type HarnessSkipReason = z.infer<typeof HarnessSkipReason>;

/**
 * A repository's guideline files and the files they reach, at a PR's base commit: the roots in
 * GUIDELINE_PATHS order, then breadth-first in the order they're linked.
 */
export const Harness = z
  .object({
    baseSha: Sha,
    files: z.array(HarnessFile).readonly(),
    /** The limit the walk stopped at, so a linked file may be left out; null when at none. */
    cut: z.enum(["depth", "files"]).nullable(),
    skipped: z
      .array(z.object({ path: z.string(), reason: HarnessSkipReason }).readonly())
      .readonly(),
    /** Paths looked for that aren't files at the commit, so a later walk needn't ask again. */
    missing: z.array(z.string()).readonly(),
  })
  .readonly();
export type Harness = z.infer<typeof Harness>;

/** How many links a file can be from a root. */
export const MAX_HARNESS_DEPTH = 5;
export const MAX_HARNESS_FILES = 200;
/** Paths one walk asks a source for without knowing whether they exist. */
export const MAX_HARNESS_LOOKUPS = 400;
export const MAX_HARNESS_FILE_BYTES = 1_048_576;

/** A path in prose can mean two files: the first of `paths` that's one is the one it links. */
export interface HarnessLink {
  readonly kind: HarnessLinkKind;
  readonly paths: readonly string[];
}

const LINKABLE = /[^/]\.(?:md|mdc|markdown|txt)$/i;
const MAX_PATH_LENGTH = 500;

/** Stands for text no link is read from. A private-use character, so it's no path's or space. */
const MASK = "";
const masked = (text: string): string => text.replace(/[^\n]/g, MASK);

const lineList = (content: string): string[] => {
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
};

/** Which lines are in a fenced block, its fences with them. One that never closes runs to the end. */
const fencedLines = (lines: readonly string[]): boolean[] => {
  let fence: string | null = null;
  return lines.map((line) => {
    if (fence === null) {
      // A fence can be in a quote or a list item.
      const opened = /^[\s>]*(?:(?:[-*+]|\d{1,9}[.)])\s+)?(`{3,}|~{3,})([^\n]*)$/.exec(line);
      const [, marks, info] = opened ?? [];
      if (marks === undefined || (marks.startsWith("`") && info?.includes("`"))) return false;
      fence = marks;
      return true;
    }
    const marks = line.replace(/^[\s>]+/, "").trimEnd();
    if (marks.length >= fence.length && marks === fence.charAt(0).repeat(marks.length))
      fence = null;
    return true;
  });
};

const maskFences = (content: string): string => {
  const lines = content.split("\n");
  const fenced = fencedLines(lines);
  return lines.map((line, index) => (fenced[index] ? masked(line) : line)).join("\n");
};

/** A span's backticks are closed by as many, in the same paragraph. */
const maskSpans = (text: string): string => {
  const spans: { start: number; end: number }[] = [];
  let runs: { start: number; length: number }[] = [];
  const closeParagraph = () => {
    for (let at = 0; at < runs.length; at += 1) {
      const open = runs[at];
      let close = at + 1;
      while (close < runs.length && runs[close]?.length !== open?.length) close += 1;
      const closing = runs[close];
      if (open === undefined || closing === undefined) continue;
      spans.push({ start: open.start, end: closing.start + closing.length });
      at = close;
    }
    runs = [];
  };
  for (const match of text.matchAll(/`+|\n[ \t\r]*(?=\n)/g)) {
    if (match[0].startsWith("`")) runs.push({ start: match.index, length: match[0].length });
    else closeParagraph();
  }
  closeParagraph();
  let out = "";
  let from = 0;
  for (const { start, end } of spans) {
    out += text.slice(from, start) + masked(text.slice(start, end));
    from = end;
  }
  return out + text.slice(from);
};

/** `target` from `folder`, or null when it leaves the repository or isn't a file to link. */
const resolved = (folder: readonly string[], target: string): string | null => {
  const segments = [...folder];
  for (const segment of target.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment !== "..") segments.push(segment);
    else if (segments.pop() === undefined) return null;
  }
  const path = segments.join("/");
  return LINKABLE.test(path) && path.length <= MAX_PATH_LENGTH && !/\p{Cc}/u.test(path)
    ? path
    : null;
};

const decoded = (target: string): string => {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
};

const withoutAnchor = (target: string): string => target.replace(/#.*$/s, "");

/**
 * The files `content`, the file at `path`, links, each once, where it's first linked by its
 * strongest kind. Nothing in a code span or a fence is a link, and neither is a URL, a path under
 * `~` or one that leaves the repository.
 */
export const harnessLinks = (path: string, content: string): HarnessLink[] => {
  const folder = path.split("/").slice(0, -1);
  const found: (HarnessLink & { readonly at: number })[] = [];
  const add = (at: number, kind: HarnessLinkKind, candidates: readonly (string | null)[]) => {
    const paths = [...new Set(candidates.filter((candidate) => candidate !== null))];
    // The file itself is there, so nothing after it is what's meant.
    const self = paths.indexOf(path);
    const others = self === -1 ? paths : paths.slice(0, self);
    if (others.length > 0) found.push({ at, kind, paths: others });
  };

  let text = maskSpans(maskFences(content));

  const addLink = (at: number, target: string) => {
    if (/^[a-z][a-z0-9+.-]*:|^\/\/|^~/i.test(target)) return;
    const file = decoded(withoutAnchor(target).replace(/\?.*$/s, ""));
    // Both hosts read a leading slash in a link as the repository's root.
    add(at, "link", [resolved(file.startsWith("/") ? [] : folder, file)]);
  };
  for (const pattern of [
    /\[[^[\]]*\]\(\s*(?:<([^<>\n]*)>|([^\s()<>]+))/g,
    // What closes a label with a link of its own in it.
    /\]\(\s*(?:<([^<>\n]*)>|([^\s()<>]+))/g,
    /^ {0,3}\[[^[\]\n]+\]:[ \t]*(?:<([^<>\n]*)>|(\S+))/gm,
  ]) {
    text = text.replace(pattern, (match, angled?: string, bare?: string, at?: number) => {
      addLink(at ?? 0, angled ?? bare ?? "");
      return masked(match);
    });
  }

  text = text.replace(/\b(?:[a-z][a-z0-9+.-]{0,30}:\/\/|www\.)[^\s<>]*/gi, masked);

  const inProse = (token: string): string =>
    token.length > MAX_PATH_LENGTH
      ? ""
      : withoutAnchor(token.replace(/^@/, "").replace(/[.,;:!?)\]}"'*_]+$/, ""));
  const isRelative = (target: string): boolean => /^[^~/$\\]/.test(target);

  text = text.replace(
    /(^|\s)@((?:\\ |[^\s])+)/g,
    (match, before: string, token: string, at: number) => {
      const target = inProse(token).replaceAll("\\ ", " ");
      if (isRelative(target)) add(at + before.length, "import", [resolved(folder, target)]);
      return before + masked(match.slice(before.length));
    },
  );

  for (const match of text.matchAll(/[^\s`"'()*<>[\]{}|,;!?:=“”‘’—–]+/g)) {
    const target = inProse(match[0]).replace(/\\(?=[_.-])/g, "");
    if (isRelative(target)) {
      add(match.index, "mention", [resolved(folder, target), resolved([], target)]);
    }
  }

  const strength = ({ kind }: HarnessLink) => HarnessLinkKind.options.indexOf(kind);
  const once = new Map<string, (typeof found)[number]>();
  for (const link of found.sort((a, b) => strength(a) - strength(b) || a.at - b.at)) {
    const key = link.paths.join("\n");
    if (!once.has(key)) once.set(key, link);
  }
  return [...once.values()].sort((a, b) => a.at - b.at).map(({ kind, paths }) => ({ kind, paths }));
};

export const strongerLink = (a: HarnessLinkKind, b: HarnessLinkKind): HarnessLinkKind => {
  const strength = HarnessLinkKind.options;
  return strength.indexOf(a) <= strength.indexOf(b) ? a : b;
};

const atxHeading = (line: string): { level: number; text: string } | null => {
  const marks = /^ {0,3}(#{1,6})(?=[ \t]|$)/.exec(line);
  if (marks?.[1] === undefined) return null;
  const text = line.slice(marks[0].length).trim();
  let end = text.length;
  while (text.charAt(end - 1) === "#") end -= 1;
  const closed = end === 0 || /[ \t]/.test(text.charAt(end - 1));
  return { level: marks[1].length, text: closed ? text.slice(0, end).trimEnd() : text };
};

/** A file's headings with their 1-based lines, and how many lines it has. */
export const harnessOutline = (
  content: string,
): { readonly headings: readonly HarnessHeading[]; readonly lines: number } => {
  const lines = lineList(content).map((line) => line.replace(/\r$/, ""));
  const fenced = fencedLines(lines);
  const frontMatterEnd = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  const headings: HarnessHeading[] = [];
  for (const [index, line] of lines.entries()) {
    if (index <= frontMatterEnd || fenced[index]) continue;
    const atx = atxHeading(line);
    if (atx !== null) {
      if (atx.text !== "") headings.push({ ...atx, line: index + 1 });
      continue;
    }
    const underline = /^ {0,3}(?:(=+)|-+)[ \t]*$/.exec(line);
    const above = lines[index - 1]?.trim() ?? "";
    const alone = index - 2 <= frontMatterEnd || (lines[index - 2]?.trim() ?? "") === "";
    // Only a line of prose on its own: under a list, a quote or a table it's a rule.
    if (
      underline !== null &&
      index - 1 > frontMatterEnd &&
      alone &&
      /^(?!\d+[.)]\s)[^#>|\-*+`~]/.test(above)
    ) {
      headings.push({ level: underline[1] === undefined ? 2 : 1, text: above, line: index });
    }
  }
  return { headings, lines: lines.length };
};

/** The files at `from`, then breadth-first the ones they link and `follow` lets through. */
const reach = (
  harness: Harness,
  from: readonly string[],
  follow: (file: HarnessFile, kind: HarnessLinkKind | "root") => boolean,
): HarnessFile[] => {
  const byPath = new Map(harness.files.map((file) => [file.path, file]));
  const reached = new Map<string, HarnessFile>();
  const visit = (path: string, kind: HarnessLinkKind | "root") => {
    const file = byPath.get(path);
    if (file !== undefined && follow(file, kind)) reached.set(path, file);
  };
  for (const path of from) visit(path, "root");
  // A Map's iteration reaches what's added to it on the way.
  for (const file of reached.values()) {
    for (const link of file.links) if (!reached.has(link.path)) visit(link.path, link.kind);
  }
  return [...reached.values()];
};

/** Every file a file reaches, nearest first, whatever is switched on. */
export const harnessReach = (harness: Harness, path: string): HarnessFile[] =>
  reach(harness, [path], () => true).filter((file) => file.path !== path);

const switchedOn = (file: HarnessFile, switches: ReadonlyMap<string, boolean>): boolean =>
  file.via === "root" ? guidelineEnabled(file.path, switches) : (switches.get(file.path) ?? true);

/** The files a run may use, nearest a root first. */
const enabledFiles = (harness: Harness, switches: ReadonlyMap<string, boolean>): HarnessFile[] =>
  reach(harness, GUIDELINE_PATHS, (file) => switchedOn(file, switches));

/**
 * Whether a run may use a file: a root by its switch, any other unless its own is off, and only
 * when an enabled root reaches it through enabled files.
 */
export const harnessEnabled = (
  path: string,
  harness: Harness,
  switches: ReadonlyMap<string, boolean>,
): boolean => enabledFiles(harness, switches).some((file) => file.path === path);

export interface HarnessPlan {
  /** Put in every pass's prompt: the enabled roots, then what they import, while they fit. */
  readonly inPrompt: readonly HarnessFile[];
  /** The other enabled files, nearest a root first. */
  readonly onRequest: readonly HarnessFile[];
  /** Of `onRequest`, the roots and imports that don't fit the prompt. */
  readonly passedOver: readonly HarnessFile[];
}

/** The files that fit in a prompt, in order: one that doesn't is passed over and the next tried. */
export const fitInPrompt = <T extends { readonly bytes: number }>(
  files: readonly T[],
): { readonly fitting: T[]; readonly passedOver: T[] } => {
  const fitting: T[] = [];
  const passedOver: T[] = [];
  let left = MAX_INLINE_BYTES;
  for (const file of files) {
    if (file.bytes > left) {
      passedOver.push(file);
      continue;
    }
    fitting.push(file);
    left -= file.bytes;
  }
  return { fitting, passedOver };
};

/** How a run uses each enabled file. One that doesn't fit the prompt is passed over, never cut. */
export const harnessPlan = (
  harness: Harness,
  switches: ReadonlyMap<string, boolean>,
): HarnessPlan => {
  const always = reach(
    harness,
    GUIDELINE_PATHS,
    (file, kind) => (kind === "root" || kind === "import") && switchedOn(file, switches),
  );
  const { fitting, passedOver } = fitInPrompt(always);
  const given = new Set(fitting.map((file) => file.path));
  return {
    inPrompt: fitting,
    onRequest: enabledFiles(harness, switches).filter((file) => !given.has(file.path)),
    passedOver,
  };
};
