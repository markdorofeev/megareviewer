import { MODEL } from "./request.ts";

/**
 * Bump whenever a prompt, the input rendering, the output schema or the request settings
 * change, and set PROMPT_FINGERPRINT to the value the version test prints. The version is part
 * of the analysis cache key, so a stale one would serve analyses made with the old prompts.
 */
export const PROMPT_VERSION = 16;
export const PROMPT_FINGERPRINT = "0cf796199906ab9d";
/** The same, of the steps pass, which only a run that asks for the tour sends. */
export const TOUR_FINGERPRINT = "2d478334836c891d";

export const apiVersion = (model: string): string => `${model}/p${PROMPT_VERSION}`;

export const VERSION = apiVersion(MODEL);

/**
 * The Claude Code transport's own prompt version: its system prompt and arguments differ from
 * the API's, so an analysis made on one transport isn't served for the other. Bump it as above,
 * with CLAUDE_CODE_FINGERPRINT.
 */
export const CLAUDE_CODE_PROMPT_VERSION = 13;
export const CLAUDE_CODE_FINGERPRINT = "3772d089a53898a6";
export const CLAUDE_CODE_TOUR_FINGERPRINT = "8b3948466b6041bd";

/** An effort for every pass, in place of each pass's own, is named after the model. */
export const claudeCodeVersion = (model: string, effort?: string): string =>
  `claude-code/${model}${effort === undefined ? "" : `@${effort}`}/p${CLAUDE_CODE_PROMPT_VERSION}`;

export const CLAUDE_CODE_VERSION = claudeCodeVersion(MODEL);
