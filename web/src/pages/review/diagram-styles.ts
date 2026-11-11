import type { RiskClass } from "../../../../src/domain/review/index.ts";

// The overview's and the miniature's colors and line styles, from the tokens. Spelled out because
// Tailwind only generates the classes it finds whole in the source.

/** A directory's box by its highest risk: a tint and text of the risk, a border the reader sees. */
export const NODE_RISK: Readonly<Record<RiskClass, string>> = {
  contract: "border-risk-contract-solid bg-risk-contract-bg text-risk-contract",
  logic: "border-risk-logic-solid bg-risk-logic-bg text-risk-logic",
  mechanical: "border-risk-mechanical-solid bg-risk-mechanical-bg text-risk-mechanical",
};

/** Files outside the pull request: dashed, on the page's subtle surface, muted text. */
export const NODE_OUTSIDE = "border-dashed border-input bg-surface-subtle text-muted-foreground";

/**
 * An edge by what it carries. Calls are solid, imports dashed, types dotted; a request crosses into
 * another process, so it's heavier and broken unlike any call; an edge from outside the PR fades.
 */
export const EDGE_LINE: Readonly<Record<string, string>> = {
  call: "",
  import: "[stroke-dasharray:6_4]",
  request: "stroke-muted-foreground [stroke-dasharray:12_4_3_4] [stroke-width:2.5]",
  type: "[stroke-dasharray:1.5_3] [stroke-linecap:round]",
  outside: "[stroke-dasharray:4_4] opacity-60",
};

/** The same, thinner, for the miniature. */
export const MINI_EDGE_LINE: Readonly<Record<string, string>> = {
  call: "",
  import: "[stroke-dasharray:3_2]",
  request: "stroke-muted-foreground [stroke-dasharray:6_2_1.5_2] [stroke-width:1.5]",
  type: "[stroke-dasharray:1_2]",
  outside: "[stroke-dasharray:2_2] opacity-60",
};
