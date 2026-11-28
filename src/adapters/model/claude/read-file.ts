import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { HarnessRead } from "../../../domain/review/index.ts";

/** The one tool of a pass with something to read. megareviewer serves it, so it reaches no disk. */
export const READ_FILE: Anthropic.Beta.Messages.BetaTool = {
  name: "read_file",
  description:
    "Reads one of the files listed in <readable_files>, whole or by lines. Nothing else can be read.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "The path its line in <readable_files> starts with." },
      first_line: {
        type: "integer",
        description: "The first line to read. Without it, from the start of the file.",
      },
      last_line: {
        type: "integer",
        description: "The last line to read. Without it, to the end of the file.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
};

const PathInput = z.object({ path: z.string() });

const LineNumber = z.number().int().positive().nullish();
const LinesInput = z.object({ first_line: LineNumber, last_line: LineNumber });

export interface ToolUse {
  readonly id: string;
  readonly name: string;
  /** The model's, so untrusted. */
  readonly input: unknown;
}

export interface ServedUse {
  readonly result: Anthropic.Beta.Messages.BetaToolResultBlockParam;
  /** Null for a use that names no file. */
  readonly read: HarnessRead | null;
}

const refused = (use: ToolUse, path: string | null, problem: string, round: number): ServedUse => ({
  result: { type: "tool_result", tool_use_id: use.id, is_error: true, content: problem },
  read:
    path === null
      ? null
      : {
          path,
          fromLine: null,
          toLine: null,
          outcome: "refused",
          round,
          tool: "read",
          reason: problem,
        },
});

/**
 * One use of the tool in the call's `round`th round of reading, answered from the run's files:
 * what it asked for, or why it can't have it.
 */
export const serveRead = (
  use: ToolUse,
  files: ReadonlyMap<string, string>,
  round: number,
): ServedUse => {
  const asked = PathInput.safeParse(use.input);
  if (use.name !== READ_FILE.name || !asked.success) {
    return refused(use, null, `Use ${READ_FILE.name} with the path of a file to read.`, round);
  }
  const { path } = asked.data;
  const content = files.get(path);
  if (content === undefined) {
    return refused(use, path, `${path} isn't one of the files to read.`, round);
  }

  const lines = content.replace(/\n$/, "").split("\n");
  const range = LinesInput.safeParse(use.input);
  const first = range.data?.first_line ?? 1;
  const last = Math.min(range.data?.last_line ?? lines.length, lines.length);
  if (!range.success || first > last) {
    return refused(
      use,
      path,
      `${path} has no such lines: its lines are 1 to ${lines.length}.`,
      round,
    );
  }
  const text = lines.slice(first - 1, last).join("\n");
  const whole = first === 1 && last === lines.length;
  // The API refuses a text that's only whitespace.
  const given = text.trim() === "" ? "(blank)" : text;
  return {
    result: { type: "tool_result", tool_use_id: use.id, content: given },
    read: {
      path,
      fromLine: whole ? null : first,
      toLine: whole ? null : last,
      outcome: "read",
      round,
      tool: "read",
      chars: given.length,
    },
  };
};
