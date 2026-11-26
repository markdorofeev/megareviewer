/**
 * opencode's own prompt version: its prompt asks for JSON and carries the schema, which Claude's and
 * Codex's don't, so an analysis made through one isn't served for another. Bump it whenever a
 * prompt, the input rendering, the output schema, the config or the request bodies change, and set
 * OPENCODE_FINGERPRINT to the value the request test prints. The version is part of the analysis
 * cache key.
 */
export const OPENCODE_PROMPT_VERSION = 15;
export const OPENCODE_FINGERPRINT = "de12b604b731bd7b";
/** The same, of the steps pass, which only a run that asks for the tour sends. */
export const OPENCODE_TOUR_FINGERPRINT = "ca374c7ddd13dda6";

/** The same, of a run with something to read, which the others send nothing of. */
export const OPENCODE_READER_FINGERPRINT = "725f886cd506b4c4";

/** Names the model on its provider; an effort for every pass, in place of each pass's own, too. */
export const opencodeVersion = (providerID: string, model: string, effort?: string): string =>
  `opencode/${providerID}/${model}${effort === undefined ? "" : `@${effort}`}/p${OPENCODE_PROMPT_VERSION}`;
