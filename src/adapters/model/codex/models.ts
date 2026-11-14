import { EFFORTS, type Effort } from "../shared/effort.ts";

/** US dollars per million tokens, at the API's standard tier up to 272K input tokens. */
export interface OpenAiPrice {
  readonly input: number;
  readonly cachedInput: number;
  /** A write with the default 30-minute lifetime. */
  readonly cacheWrite: number;
  readonly output: number;
}

/** An OpenAI model the passes can run on through Codex. */
export interface CodexModel {
  /** Codex's slug: "gpt-6-luna". */
  readonly id: string;
  /** "GPT-6 Luna" */
  readonly name: string;
  /** Null for a model OpenAI's price list doesn't have: its runs show tokens and no cost. */
  readonly price: OpenAiPrice | null;
}

/**
 * The models megareviewer lists through Codex, cheapest first, each measured by the evals
 * (evals/reports/). An option is one of these that the reviewer's `codex debug models` lists.
 * Prices from https://developers.openai.com/api/docs/pricing on 2026-11-14: check them whenever a
 * model is added.
 */
export const CODEX_MODELS: readonly CodexModel[] = [
  {
    id: "gpt-6-luna",
    name: "GPT-6 Luna",
    price: { input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5 },
  },
  {
    id: "gpt-6-sol",
    name: "GPT-6 Sol",
    price: { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 10 },
  },
];

export const codexModel = (id: string): CodexModel | undefined =>
  CODEX_MODELS.find((model) => model.id === id);

/** The effort a pass asks for, or the nearest one the model accepts, the lower on a tie. */
export const codexEffort = (accepted: readonly string[], effort: Effort): string => {
  if (accepted.length === 0 || accepted.includes(effort)) return effort;
  const rank = (level: string) => {
    const index = EFFORTS.findIndex((known) => known === level);
    // Above "high": Codex's xhigh, max and ultra.
    return index === -1 ? EFFORTS.length : index;
  };
  return (
    [...accepted].sort(
      (a, b) =>
        Math.abs(rank(a) - rank(effort)) - Math.abs(rank(b) - rank(effort)) || rank(a) - rank(b),
    )[0] ?? effort
  );
};

export interface CodexTokens {
  readonly inputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly outputTokens: number;
}

/** One call's cost at API prices, or null without a known price. */
export const codexCostUsd = (price: OpenAiPrice | null, tokens: CodexTokens): number | null =>
  price === null
    ? null
    : (tokens.inputTokens * price.input +
        tokens.cacheReadTokens * price.cachedInput +
        tokens.cacheWriteTokens * price.cacheWrite +
        tokens.outputTokens * price.output) /
      1_000_000;

/** When Codex is the first provider that can run. */
export const DEFAULT_CODEX_MODEL = "gpt-6-sol";
