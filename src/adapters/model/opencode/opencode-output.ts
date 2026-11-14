import { z } from "zod";

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
   * What the session did besides answering: a tool call, a shell, a skill loaded, a second step, or
   * a message of a kind megareviewer doesn't know.
   */
  readonly tools: readonly string[];
}

/**
 * Reads a pass's messages. Anything that isn't the user's prompt, one answer of text and reasoning,
 * or the turn's end counts as a tool: the check fails safe on what opencode adds later.
 */
export const readTurn = (json: unknown): OpencodeTurn | null => {
  const parsed = SessionMessages.safeParse(json);
  if (!parsed.success) return null;
  const tools: string[] = [];
  const answers: z.infer<typeof Assistant>[] = [];
  let idle: z.infer<typeof Idle> | null = null;
  for (const message of parsed.data.data) {
    const assistant = Assistant.safeParse(message);
    if (assistant.success) {
      answers.push(assistant.data);
      for (const item of assistant.data.content) {
        if (item.type !== "text" && item.type !== "reasoning") {
          tools.push(item.type === "tool" ? (item.name ?? "a tool") : item.type);
        }
      }
      continue;
    }
    const ended = Idle.safeParse(message);
    if (ended.success) {
      idle = ended.data;
      continue;
    }
    if (!BOOKKEEPING.has(message.type)) tools.push(message.type);
  }
  if (answers.length > 1) tools.push(`${answers.length} steps`);

  const sum = (pick: (tokens: z.infer<typeof Tokens>) => number) =>
    answers.reduce((total, answer) => total + (answer.tokens ? pick(answer.tokens) : 0), 0);
  const texts = answers.flatMap((answer) =>
    answer.content.flatMap((item) => (item.type === "text" && item.text ? [item.text] : [])),
  );
  const last = answers.at(-1);
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
  };
};

const FENCE = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/;

/**
 * The JSON object an answer holds. Asked for one object and nothing else, a model may still wrap it
 * in a code fence or a sentence, so the outermost braces are taken.
 */
export const answerJson = (text: string): unknown => {
  const trimmed = text.trim();
  const fenced = FENCE.exec(trimmed)?.[1] ?? trimmed;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start === -1 || end < start) return undefined;
  try {
    return JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return undefined;
  }
};
