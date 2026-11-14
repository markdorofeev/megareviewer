import { EFFORTS, type Effort } from "../shared/effort.ts";

/** US dollars per million tokens. */
export interface RateCard {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  /** Writes with the default 5-minute lifetime: 1.25× input. */
  readonly cacheWrite: number;
}

export interface ModelPrice extends RateCard {
  /** A request whose prompt is longer than `aboveTokens` is billed at these rates instead. */
  readonly longPrompt?: { readonly aboveTokens: number; readonly rates: RateCard };
}

/** A Claude model the passes can run on, as each transport needs it. */
export interface ClaudeModel {
  readonly id: string;
  /** "Sonnet 5.5" */
  readonly name: string;
  readonly price: ModelPrice;
  /** The largest PR, in input tokens, either transport sends. */
  readonly maxInputTokens: number;
  /** The API path's `max_tokens`, and what Claude Code reports as the limit under -p. */
  readonly maxOutputTokens: { readonly api: number; readonly claudeCode: number };
  readonly efforts: readonly Effort[];
}

/** Every one has 1M tokens of context; the budget keeps a PR to what a reviewer pays cents for. */
const MAX_INPUT_TOKENS = 400_000;
const MAX_OUTPUT_TOKENS = { api: 64_000, claudeCode: 128_000 } as const;

/**
 * The models megareviewer lists, cheapest first, each measured by the evals (evals/reports/).
 * First-party API prices from the claude-api skill's table (cached 2026-11-03): check them
 * whenever a model is added.
 */
export const CLAUDE_MODELS: readonly ClaudeModel[] = [
  {
    id: "claude-haiku-5-5",
    name: "Haiku 5.5",
    price: {
      input: 0.1,
      output: 0.5,
      cacheRead: 0.01,
      cacheWrite: 0.125,
      longPrompt: {
        aboveTokens: 100_000,
        rates: { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 },
      },
    },
    maxInputTokens: MAX_INPUT_TOKENS,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    efforts: EFFORTS,
  },
  {
    id: "claude-sonnet-5-5",
    name: "Sonnet 5.5",
    price: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
    maxInputTokens: MAX_INPUT_TOKENS,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    efforts: EFFORTS,
  },
  {
    id: "claude-opus-5-5",
    name: "Opus 5.5",
    price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
    maxInputTokens: MAX_INPUT_TOKENS,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    efforts: EFFORTS,
  },
];

/** Sonnet: on the evals it says far less that's wrong than Haiku. ARCHITECTURE.md has the trade-off. */
export const DEFAULT_MODEL = "claude-sonnet-5-5";

export const claudeModel = (id: string): ClaudeModel | undefined =>
  CLAUDE_MODELS.find((model) => model.id === id);

/** The effort a pass asks for, or the nearest one the model accepts, the lower on a tie. */
export const effortFor = (model: ClaudeModel | undefined, effort: Effort): Effort => {
  if (model === undefined || model.efforts.includes(effort)) return effort;
  const rank = (level: Effort) => EFFORTS.indexOf(level);
  return (
    [...model.efforts].sort(
      (a, b) =>
        Math.abs(rank(a) - rank(effort)) - Math.abs(rank(b) - rank(effort)) || rank(a) - rank(b),
    )[0] ?? effort
  );
};
