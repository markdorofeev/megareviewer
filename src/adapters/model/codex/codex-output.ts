import { z } from "zod";

const Count = z.number().int().nonnegative();

const ThreadStarted = z.object({ type: z.literal("thread.started"), thread_id: z.string() });

const Item = z.object({
  type: z.enum(["item.started", "item.updated", "item.completed"]),
  item: z.object({ id: z.string().optional(), type: z.string() }).loose(),
});

const AgentMessage = z.object({ type: z.literal("agent_message"), text: z.string() });

const ItemError = z.object({ type: z.literal("error"), message: z.string() });

/** OpenAI's counts: input_tokens is every prompt token, cached and written ones among them. */
const TurnCompleted = z.object({
  type: z.literal("turn.completed"),
  usage: z.object({
    input_tokens: Count,
    cached_input_tokens: Count.default(0),
    cache_write_input_tokens: Count.default(0),
    output_tokens: Count,
  }),
});

const TurnFailed = z.object({
  type: z.literal("turn.failed"),
  error: z.object({ message: z.string() }),
});

const StreamError = z.object({ type: z.literal("error"), message: z.string() });

/**
 * Items that are the model talking, or Codex reporting a problem of its own ("Falling back from
 * WebSockets to HTTPS transport"). Every other item is a tool the model used: a command, an MCP
 * call, a file change, a web search, an agent, or one this version doesn't know yet.
 */
const MODEL_ITEMS: ReadonlySet<string> = new Set(["reasoning", "agent_message", "error"]);

export interface CodexUsage {
  /** Neither read from nor written to cache. */
  readonly inputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly outputTokens: number;
}

export interface CodexStream {
  readonly threadId: string | null;
  /** The last message's text: with --output-schema, the answer as JSON. */
  readonly message: string | null;
  readonly usage: CodexUsage | null;
  /** Why the turn failed, as Codex says it. */
  readonly failure: string | null;
  /** Codex's errors and retries, last first. */
  readonly errors: readonly string[];
  /** The tools the model used, by item type. */
  readonly tools: readonly string[];
}

const json = (line: string): unknown => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};

/** The tool a line shows the model using, or null when it shows none. */
export const toolOf = (line: string): string | null => {
  const event = Item.safeParse(json(line));
  if (!event.success) return null;
  const { item } = event.data;
  if (MODEL_ITEMS.has(item.type)) return null;
  const detail =
    typeof item.command === "string"
      ? item.command
      : typeof item.tool === "string"
        ? item.tool
        : null;
  return detail === null ? item.type : `${item.type} (${detail})`;
};

/** What a pass's `--json` lines say. Unknown events and fields are ignored. */
export const parseCodexStream = (lines: readonly string[]): CodexStream => {
  let threadId: string | null = null;
  let message: string | null = null;
  let usage: CodexUsage | null = null;
  let failure: string | null = null;
  const errors: string[] = [];
  const tools: string[] = [];

  for (const line of lines) {
    const event = json(line);
    const started = ThreadStarted.safeParse(event);
    if (started.success) {
      threadId ??= started.data.thread_id;
      continue;
    }
    const item = Item.safeParse(event);
    if (item.success) {
      const tool = toolOf(line);
      if (tool !== null && !tools.includes(tool)) tools.push(tool);
      if (item.data.type !== "item.completed") continue;
      const said = AgentMessage.safeParse(item.data.item);
      if (said.success) message = said.data.text;
      const failed = ItemError.safeParse(item.data.item);
      if (failed.success) errors.unshift(failed.data.message);
      continue;
    }
    const done = TurnCompleted.safeParse(event);
    if (done.success) {
      const counts = done.data.usage;
      const cacheRead = counts.cached_input_tokens;
      const cacheWrite = counts.cache_write_input_tokens;
      usage = {
        inputTokens: Math.max(0, counts.input_tokens - cacheRead - cacheWrite),
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        outputTokens: counts.output_tokens,
      };
      continue;
    }
    const turnFailed = TurnFailed.safeParse(event);
    if (turnFailed.success) {
      failure = turnFailed.data.error.message;
      continue;
    }
    const error = StreamError.safeParse(event);
    if (error.success) errors.unshift(error.data.message);
  }
  return { threadId, message, usage, failure, errors, tools };
};
