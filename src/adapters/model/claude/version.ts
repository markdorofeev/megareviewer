import { MODEL } from "./request.ts";

/**
 * Bump whenever a prompt, the input rendering, the output schema or the request settings
 * change, and set PROMPT_FINGERPRINT to the value the version test prints. The version is part
 * of the analysis cache key, so a stale one would serve analyses made with the old prompts.
 */
export const PROMPT_VERSION = 7;
export const PROMPT_FINGERPRINT = "a7f2b8d8d07d743c";

export const VERSION = `${MODEL}/p${PROMPT_VERSION}`;

/**
 * The Claude Code transport's own prompt version: its system prompt and arguments differ from
 * the API's, so an analysis made on one transport isn't served for the other. Bump it as above,
 * with CLAUDE_CODE_FINGERPRINT.
 */
export const CLAUDE_CODE_PROMPT_VERSION = 5;
export const CLAUDE_CODE_FINGERPRINT = "55879685811b3037";

/** An effort for every pass, in place of each pass's own, is named after the model. */
export const claudeCodeVersion = (model: string, effort?: string): string =>
  `claude-code/${model}${effort === undefined ? "" : `@${effort}`}/p${CLAUDE_CODE_PROMPT_VERSION}`;

export const CLAUDE_CODE_VERSION = claudeCodeVersion(MODEL);
