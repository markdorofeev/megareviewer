/**
 * opencode's own prompt version: its prompt asks for JSON and carries the schema, which Claude's and
 * Codex's don't, so an analysis made through one isn't served for another. Bump it whenever a
 * prompt, the input rendering, the output schema, the config or the request bodies change, and set
 * OPENCODE_FINGERPRINT to the value the request test prints. The version is part of the analysis
 * cache key.
 */
export const OPENCODE_PROMPT_VERSION = 16;
export const OPENCODE_FINGERPRINT = "0115ba60437e4572";
/** The same, of the steps pass, which only a run that asks for the tour sends. */
export const OPENCODE_TOUR_FINGERPRINT = "eae1544ba13baea5";

/** The same, of a run with something to read, which the others send nothing of. */
export const OPENCODE_READER_FINGERPRINT = "bb5e40798124aa61";

/** Names the model on its provider; an effort for every pass, in place of each pass's own, too. */
export const opencodeVersion = (providerID: string, model: string, effort?: string): string =>
  `opencode/${providerID}/${model}${effort === undefined ? "" : `@${effort}`}/p${OPENCODE_PROMPT_VERSION}`;
