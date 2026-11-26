import { realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { HarnessRead } from "../../../domain/review/index.ts";
import { READ_TOOLS, STRUCTURED_OUTPUT_TOOL } from "./claude-code-request.ts";

const ToolUse = z.object({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.unknown(),
});

const Assistant = z.object({
  type: z.literal("assistant"),
  message: z.object({ content: z.array(z.unknown()) }),
});

const ToolResult = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string(),
  is_error: z.boolean().optional(),
});

const User = z.object({
  type: z.literal("user"),
  message: z.object({ content: z.array(z.unknown()) }),
  tool_use_result: z.unknown().optional(),
});

/** A Read's result, for the lines it gave. */
const FileResult = z.object({
  file: z.object({
    startLine: z.number().int().positive(),
    numLines: z.number().int().nonnegative(),
    totalLines: z.number().int().nonnegative(),
  }),
});

/** A Grep's result, when it shows the lines it found. */
const SearchResult = z.object({ mode: z.literal("content"), content: z.string() });

const ReadInput = z.object({ file_path: z.string() });
const SearchInput = z.object({ path: z.string().optional() });

const json = (line: string): unknown => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};

type Use = z.infer<typeof ToolUse>;

const usesIn = (event: unknown): Use[] => {
  const assistant = Assistant.safeParse(event);
  if (!assistant.success) return [];
  return assistant.data.message.content.flatMap((block) => {
    const use = ToolUse.safeParse(block);
    return use.success ? [use.data] : [];
  });
};

/** The path a use of the read tool names; null for one that names none, which is malformed. */
const pathOf = (use: Use): string | null => {
  if (use.name === "Grep") {
    const search = SearchInput.safeParse(use.input);
    return search.success ? (search.data.path ?? ".") : null;
  }
  const read = ReadInput.safeParse(use.input);
  return read.success ? read.data.file_path : null;
};

const onDisk = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

interface Place {
  readonly inside: boolean;
  /** In the directory when inside, absolute when not. */
  readonly path: string;
}

/** Where a path the model named is. A home or URL path is outside, whatever a tool makes of it. */
const place = (cwd: string, path: string): Place => {
  if (/^~|^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return { inside: false, path };
  const named = resolve(cwd, path);
  const real = onDisk(named);
  const inside = real === cwd || real.startsWith(cwd + sep);
  return inside
    ? { inside, path: relative(cwd, real).split(sep).join("/") || "." }
    : { inside, path: named };
};

/**
 * What a line of the stream shows a pass with the read tool trying that it must not: a tool it
 * shouldn't have, or a read outside its directory. Null for anything else. Claude Code sends a use
 * before it runs it and refuses such a read itself; this is the check on that.
 */
export const readOutside = (line: string, cwd: string): string | null => {
  for (const use of usesIn(json(line))) {
    if (use.name === STRUCTURED_OUTPUT_TOOL) continue;
    if (!READ_TOOLS.some((tool) => tool === use.name)) return `it used ${use.name}`;
    const path = pathOf(use);
    if (path === null) continue;
    const { inside, path: at } = place(cwd, path);
    if (!inside) return `it tried to read ${at}, which isn't one of the harness's files`;
  }
  return null;
};

const WHOLE = { fromLine: null, toLine: null } as const;

/** What one use that ran gave: the lines of a Read, or the files a Grep showed lines of. */
const given = (
  use: Use,
  path: string,
  result: unknown,
  readable: ReadonlySet<string>,
): HarnessRead[] => {
  if (use.name === "Grep") {
    const search = SearchResult.safeParse(result);
    // Without the lines, a search says only which files match.
    if (!search.success) return readable.has(path) ? [] : [{ path, ...WHOLE, outcome: "read" }];
    if (readable.has(path)) return [{ path, ...WHOLE, outcome: "read" }];
    const shown = [...readable].filter((file) =>
      search.data.content.split("\n").some((found) => found.startsWith(`${file}:`)),
    );
    return (shown.length === 0 ? [path] : shown).map((file) => ({
      path: file,
      ...WHOLE,
      outcome: "read",
    }));
  }
  const file = FileResult.safeParse(result);
  if (!file.success) return [{ path, ...WHOLE, outcome: "read" }];
  const { startLine, numLines, totalLines } = file.data.file;
  const whole = startLine === 1 && numLines >= totalLines;
  return [
    {
      path,
      ...(whole
        ? WHOLE
        : { fromLine: startLine, toLine: Math.max(startLine, startLine + numLines - 1) }),
      outcome: "read",
    },
  ];
};

/**
 * What a pass read of `readable`, the files in its directory, and what it was refused, in order. A
 * use without a result, as when the pass was killed on it, was refused.
 */
export const parseReads = (
  lines: readonly string[],
  cwd: string,
  readable: ReadonlySet<string>,
): HarnessRead[] => {
  const events = lines.map(json);
  const results = new Map<string, { readonly refused: boolean; readonly result: unknown }>();
  for (const event of events) {
    const user = User.safeParse(event);
    if (!user.success) continue;
    for (const block of user.data.message.content) {
      const result = ToolResult.safeParse(block);
      if (!result.success) continue;
      results.set(result.data.tool_use_id, {
        refused: result.data.is_error === true,
        result: user.data.tool_use_result,
      });
    }
  }
  return events.flatMap(usesIn).flatMap((use): HarnessRead[] => {
    const named = use.name === STRUCTURED_OUTPUT_TOOL ? null : pathOf(use);
    if (named === null) return [];
    const { path } = place(cwd, named);
    const ran = results.get(use.id);
    return ran === undefined || ran.refused
      ? [{ path, ...WHOLE, outcome: "refused" }]
      : given(use, path, ran.result, readable);
  });
};
