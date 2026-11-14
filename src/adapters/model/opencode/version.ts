/**
 * opencode's own prompt version: its prompt asks for JSON and carries the schema, which Claude's and
 * Codex's don't, so an analysis made through one isn't served for another. Bump it whenever a
 * prompt, the input rendering, the output schema, the config or the request bodies change, and set
 * OPENCODE_FINGERPRINT to the value the request test prints. The version is part of the analysis
 * cache key.
 */
export const OPENCODE_PROMPT_VERSION = 1;
export const OPENCODE_FINGERPRINT = "31301a12a34028ed";

/** Names the model on its provider; an effort for every pass, in place of each pass's own, too. */
export const opencodeVersion = (providerID: string, model: string, effort?: string): string =>
  `opencode/${providerID}/${model}${effort === undefined ? "" : `@${effort}`}/p${OPENCODE_PROMPT_VERSION}`;
