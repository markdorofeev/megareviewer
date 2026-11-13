import { z } from "zod";

const Init = z.object({
  type: z.literal("system"),
  subtype: z.literal("init"),
  tools: z.array(z.string()),
  mcp_servers: z.array(z.object({ name: z.string() }).loose()),
  apiKeySource: z.string().optional(),
  claude_code_version: z.string().optional(),
});

const RateLimit = z.object({
  type: z.literal("rate_limit_event"),
  rate_limit_info: z.object({
    status: z.string(),
    resetsAt: z.number().optional(),
    rateLimitType: z.string().optional(),
  }),
});

/** An answer Claude Code made up for a failure, such as not being signed in. */
const AssistantError = z.object({
  type: z.literal("assistant"),
  error: z.string(),
  message: z.object({
    content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  }),
});

const Count = z.number().int().nonnegative();

const Result = z.object({
  type: z.literal("result"),
  subtype: z.string().optional(),
  is_error: z.boolean(),
  result: z.string().optional(),
  structured_output: z.unknown().optional(),
  stop_reason: z.string().nullable().optional(),
  api_error_status: z.number().nullable().optional(),
  total_cost_usd: z.number().nonnegative(),
  usage: z.object({
    input_tokens: Count,
    cache_read_input_tokens: Count.default(0),
    cache_creation_input_tokens: Count.default(0),
    output_tokens: Count,
  }),
});

export interface ClaudeCodeInit {
  readonly tools: readonly string[];
  readonly mcpServers: readonly string[];
  /** "none" when Claude Code runs on the account it's signed in to, not an API key. */
  readonly apiKeySource: string | null;
  readonly version: string | null;
}

export interface ClaudeCodeResult {
  /** "success", or why it ended without one, such as "error_max_turns". */
  readonly subtype: string | null;
  readonly isError: boolean;
  readonly text: string;
  /** The answer, validated by Claude Code against the schema; undefined when there's none. */
  readonly structuredOutput: unknown;
  readonly stopReason: string | null;
  readonly apiErrorStatus: number | null;
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly outputTokens: number;
}

export interface ClaudeCodeStream {
  readonly init: ClaudeCodeInit | null;
  readonly rateLimit: {
    readonly status: string;
    readonly resetsAt: number | null;
    readonly window: string | null;
  } | null;
  /** The last error Claude Code reported for an answer, and its text. */
  readonly error: { readonly code: string; readonly text: string } | null;
  readonly result: ClaudeCodeResult | null;
}

const json = (line: string): unknown => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};

export const parseInit = (line: string): ClaudeCodeInit | null => {
  const init = Init.safeParse(json(line));
  return init.success
    ? {
        tools: init.data.tools,
        mcpServers: init.data.mcp_servers.map((server) => server.name),
        apiKeySource: init.data.apiKeySource ?? null,
        version: init.data.claude_code_version ?? null,
      }
    : null;
};

/** What a pass's `--output-format stream-json` lines say. Unknown events and fields are ignored. */
export const parseClaudeCodeStream = (lines: readonly string[]): ClaudeCodeStream => {
  let init: ClaudeCodeStream["init"] = null;
  let rateLimit: ClaudeCodeStream["rateLimit"] = null;
  let error: ClaudeCodeStream["error"] = null;
  let result: ClaudeCodeStream["result"] = null;

  for (const line of lines) {
    const event = json(line);
    const parsedInit = Init.safeParse(event);
    if (parsedInit.success) {
      init ??= parseInit(line);
      continue;
    }
    const limit = RateLimit.safeParse(event);
    if (limit.success) {
      const info = limit.data.rate_limit_info;
      rateLimit = {
        status: info.status,
        resetsAt: info.resetsAt ?? null,
        window: info.rateLimitType ?? null,
      };
      continue;
    }
    const failed = AssistantError.safeParse(event);
    if (failed.success) {
      const text = failed.data.message.content.flatMap((block) => block.text ?? []).join("");
      error = { code: failed.data.error, text };
      continue;
    }
    const done = Result.safeParse(event);
    if (done.success) {
      const { data } = done;
      result = {
        subtype: data.subtype ?? null,
        isError: data.is_error,
        text: data.result ?? "",
        structuredOutput: data.structured_output,
        stopReason: data.stop_reason ?? null,
        apiErrorStatus: data.api_error_status ?? null,
        costUsd: data.total_cost_usd,
        inputTokens: data.usage.input_tokens,
        cacheReadTokens: data.usage.cache_read_input_tokens,
        cacheWriteTokens: data.usage.cache_creation_input_tokens,
        outputTokens: data.usage.output_tokens,
      };
    }
  }
  return { init, rateLimit, error, result };
};
