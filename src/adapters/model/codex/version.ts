/**
 * Codex's own prompt version: its instructions and arguments differ from Claude's, so an analysis
 * made through one isn't served for another. Bump it whenever a prompt, the input rendering, the
 * output schema or the arguments change, and set CODEX_FINGERPRINT to the value the version test
 * prints. The version is part of the analysis cache key.
 */
export const CODEX_PROMPT_VERSION = 1;
export const CODEX_FINGERPRINT = "5fdaa4ed21d5b319";

/** An effort for every pass, in place of each pass's own, is named after the model. */
export const codexVersion = (model: string, effort?: string): string =>
  `codex/${model}${effort === undefined ? "" : `@${effort}`}/p${CODEX_PROMPT_VERSION}`;
