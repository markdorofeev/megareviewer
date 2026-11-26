import { relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { HarnessRead } from "../../../domain/review/index.ts";

/** What opencode says went wrong, on an assistant message or the turn's end. */
export const OpencodeError = z
  .object({
    type: z.string(),
    message: z.string(),
    status: z.number().int().optional(),
    response: z.object({ body: z.string() }).loose().optional(),
  })
  .loose();
export type OpencodeError = z.infer<typeof OpencodeError>;

const Tokens = z
  .object({
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
    reasoning: z.number().nonnegative().optional(),
    cache: z.object({ read: z.number().nonnegative(), write: z.number().nonnegative() }).loose(),
  })
  .loose();

const Content = z
  .object({ type: z.string(), text: z.string().optional(), name: z.string().optional() })
  .loose();

/** A call of opencode's `read`, with what it gave once it ran. */
const ReadTool = z.object({
  type: z.literal("tool"),
  name: z.literal("read"),
  state: z.union([
    // Its input is still coming, so it hasn't run.
    z.object({ status: z.literal("streaming") }),
    z.object({
      status: z.enum(["running", "completed", "error"]),
      input: z.object({ path: z.string() }).loose(),
      content: z.array(z.object({ text: z.string().optional() }).loose()).optional(),
      metadata: z.object({ truncated: z.boolean().optional() }).loose().optional(),
    }),
  ]),
});

/** What opencode loads by itself beside a file it read: the AGENTS.md files on the way to it. */
const LoadedInstructions = z.object({
  type: z.literal("synthetic"),
  metadata: z.object({
    instruction: z.object({ paths: z.array(z.string()).min(1) }),
  }),
});

const Assistant = z
  .object({
    type: z.literal("assistant"),
    content: z.array(Content),
    finish: z.string().optional(),
    cost: z.number().nonnegative().optional(),
    tokens: Tokens.optional(),
    error: OpencodeError.optional(),
  })
  .loose();

const Idle = z
  .object({
    type: z.literal("idle"),
    outcome: z.enum(["succeeded", "failed", "interrupted"]),
    error: OpencodeError.optional(),
  })
  .loose();

const Other = z.object({ type: z.string() }).loose();

export const SessionMessages = z.object({
  data: z.array(z.union([Assistant, Idle, Other])),
  /** Where the next page of messages starts; null or none on the last. */
  cursor: z.object({ next: z.string().nullish() }).optional(),
});

/** Messages that only record what the session was set to, which every pass has. */
const BOOKKEEPING = new Set([
  "user",
  "agent-switched",
  "agent-selected",
  "model-switched",
  "model-selected",
  "location-switched",
]);

export interface OpencodeTokens {
  readonly inputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly outputTokens: number;
}

/** One pass's session, read once its loop is idle. */
export interface OpencodeTurn {
  /** What the model said, its reasoning left out; null when it said nothing. */
  readonly text: string | null;
  readonly finish: string | null;
  readonly tokens: OpencodeTokens;
  /** As opencode reports it, from its model catalog. */
  readonly costUsd: number;
  /** The failure on the answer or the turn's end, if any. */
  readonly error: OpencodeError | null;
  readonly interrupted: boolean;
  /**
   * What the session did besides answering, and besides reading its harness's files when it has
   * any: a tool call, a shell, a skill loaded, a second step without a harness, or a message of a
   * kind megareviewer doesn't know.
   */
  readonly tools: readonly string[];
  /** What it read of the harness, and what it was refused, in order. */
  readonly reads: readonly HarnessRead[];
  /** How many messages called a tool. */
  readonly rounds: number;
}

/** The directory a pass's harness files are in, and the files, by their paths there. */
export interface PassHarness {
  readonly directory: string;
  readonly files: ReadonlySet<string>;
}

interface Place {
  readonly inside: boolean;
  /** In the directory when inside, absolute when not. */
  readonly path: string;
}

/** Where a path the model named is. A home or URL path is outside, whatever a tool makes of it. */
const place = (directory: string, path: string): Place => {
  if (/^~|^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return { inside: false, path };
  const named = resolve(directory, path);
  const inside = named === directory || named.startsWith(directory + sep);
  return inside
    ? { inside, path: relative(directory, named).split(sep).join("/") || "." }
    : { inside, path: named };
};

const WHOLE = { fromLine: null, toLine: null } as const;

/** "Read file docs/notes.md, lines 1-3": what opencode's `read` says first. */
const READ_LINES = /^Read file .*, lines (\d+)-(\d+)$/m;

const linesOf = (text: string, truncated: boolean): Pick<HarnessRead, "fromLine" | "toLine"> => {
  const [, from, to] = READ_LINES.exec(text.split("\n", 1)[0] ?? "") ?? [];
  const fromLine = Number(from);
  const toLine = Number(to);
  if (!(fromLine >= 1 && toLine >= fromLine) || (fromLine === 1 && !truncated)) return WHOLE;
  return { fromLine, toLine };
};

/** What a tool item read of the harness, and what it did that it must not have, or null for none. */
const readOf = (
  item: unknown,
  harness: PassHarness,
): { readonly read: HarnessRead | null; readonly outside: string | null } => {
  const tool = ReadTool.safeParse(item);
  if (!tool.success) {
    const named = Content.safeParse(item);
    return { read: null, outside: (named.success ? named.data.name : null) ?? "a tool" };
  }
  const { state } = tool.data;
  if (state.status === "streaming") return { read: null, outside: null };
  const { inside, path } = place(harness.directory, state.input.path);
  if (state.status !== "completed") {
    return {
      read: { path, ...WHOLE, outcome: "refused" },
      outside: inside ? null : `read of ${path}`,
    };
  }
  if (!inside || !harness.files.has(path)) return { read: null, outside: `read of ${path}` };
  const text = state.content?.find((part) => part.text !== undefined)?.text ?? "";
  const lines = linesOf(text, state.metadata?.truncated === true);
  return { read: { path, ...lines, outcome: "read" }, outside: null };
};

/** The harness's files a message of opencode's own loaded, or null for any other message. */
const loadedBy = (message: unknown, harness: PassHarness): HarnessRead[] | null => {
  const loaded = LoadedInstructions.safeParse(message);
  if (!loaded.success) return null;
  const paths = loaded.data.metadata.instruction.paths.map((path) =>
    place(harness.directory, path),
  );
  if (!paths.every(({ inside, path }) => inside && harness.files.has(path))) return null;
  return paths.map(({ path }) => ({ path, ...WHOLE, outcome: "read" }));
};

/**
 * Reads a pass's messages, oldest first. Anything that isn't the user's prompt, one answer of text
 * and reasoning, or the turn's end counts as a tool: the check fails safe on what opencode adds
 * later. A pass with a harness may read its files on the way to the answer, which is the last
 * message's.
 */
export const readTurn = (
  json: unknown,
  harness: PassHarness | null = null,
): OpencodeTurn | null => {
  const parsed = SessionMessages.safeParse(json);
  if (!parsed.success) return null;
  const tools: string[] = [];
  const reads: HarnessRead[] = [];
  const answers: z.infer<typeof Assistant>[] = [];
  let rounds = 0;
  let idle: z.infer<typeof Idle> | null = null;
  for (const message of parsed.data.data) {
    const assistant = Assistant.safeParse(message);
    if (assistant.success) {
      answers.push(assistant.data);
      const items = assistant.data.content;
      if (items.some((item) => item.type === "tool")) rounds += 1;
      for (const item of items) {
        if (item.type === "text" || item.type === "reasoning") continue;
        if (item.type !== "tool" || harness === null) {
          tools.push(item.type === "tool" ? (item.name ?? "a tool") : item.type);
          continue;
        }
        const { read, outside } = readOf(item, harness);
        if (read !== null) reads.push(read);
        if (outside !== null) tools.push(outside);
      }
      continue;
    }
    const ended = Idle.safeParse(message);
    if (ended.success) {
      idle = ended.data;
      continue;
    }
    const loaded = harness === null ? null : loadedBy(message, harness);
    if (loaded !== null) reads.push(...loaded);
    else if (!BOOKKEEPING.has(message.type)) tools.push(message.type);
  }
  if (harness === null && answers.length > 1) tools.push(`${answers.length} steps`);

  const sum = (pick: (tokens: z.infer<typeof Tokens>) => number) =>
    answers.reduce((total, answer) => total + (answer.tokens ? pick(answer.tokens) : 0), 0);
  const last = answers.at(-1);
  const texts = (last?.content ?? []).flatMap((item) =>
    item.type === "text" && item.text ? [item.text] : [],
  );
  return {
    text: texts.length === 0 ? null : texts.join(""),
    finish: last?.finish ?? null,
    tokens: {
      inputTokens: sum((tokens) => tokens.input),
      cacheReadTokens: sum((tokens) => tokens.cache.read),
      cacheWriteTokens: sum((tokens) => tokens.cache.write),
      outputTokens: sum((tokens) => tokens.output + (tokens.reasoning ?? 0)),
    },
    costUsd: answers.reduce((total, answer) => total + (answer.cost ?? 0), 0),
    error: answers.find((answer) => answer.error)?.error ?? idle?.error ?? null,
    interrupted: idle?.outcome === "interrupted",
    tools,
    reads,
    rounds,
  };
};
