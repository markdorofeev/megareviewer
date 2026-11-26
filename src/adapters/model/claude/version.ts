import { MODEL } from "./request.ts";

/**
 * Bump whenever a prompt, the input rendering, the output schema or the request settings
 * change, and set PROMPT_FINGERPRINT to the value the version test prints. The version is part
 * of the analysis cache key, so a stale one would serve analyses made with the old prompts.
 */
export const PROMPT_VERSION = 18;
export const PROMPT_FINGERPRINT = "e2c3840f44583d24";
/** The same, of a run with something to read, which the others send nothing of. */
export const READER_FINGERPRINT = "81d545b2c0f2e01c";
/** The same, of the steps pass, which only a run that asks for the tour sends. */
export const TOUR_FINGERPRINT = "2d478334836c891d";

export const apiVersion = (model: string): string => `${model}/p${PROMPT_VERSION}`;

export const VERSION = apiVersion(MODEL);

/**
 * The Claude Code transport's own prompt version: its system prompt and arguments differ from
 * the API's, so an analysis made on one transport isn't served for the other. Bump it as above,
 * with CLAUDE_CODE_FINGERPRINT.
 */
export const CLAUDE_CODE_PROMPT_VERSION = 15;
export const CLAUDE_CODE_FINGERPRINT = "335fd83816664f3b";
/** The same, of a run with something to read, which the others send nothing of. */
export const CLAUDE_CODE_READER_FINGERPRINT = "c4e29b19abbf4363";
export const CLAUDE_CODE_TOUR_FINGERPRINT = "a53440208dbd03ea";

/** An effort for every pass, in place of each pass's own, is named after the model. */
export const claudeCodeVersion = (model: string, effort?: string): string =>
  `claude-code/${model}${effort === undefined ? "" : `@${effort}`}/p${CLAUDE_CODE_PROMPT_VERSION}`;

export const CLAUDE_CODE_VERSION = claudeCodeVersion(MODEL);
