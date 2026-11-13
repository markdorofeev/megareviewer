import { MODEL } from "./request.ts";

/**
 * Bump whenever a prompt, the input rendering, the output schema or the request settings
 * change, and set PROMPT_FINGERPRINT to the value the version test prints. The version is part
 * of the analysis cache key, so a stale one would serve analyses made with the old prompts.
 */
export const PROMPT_VERSION = 6;
export const PROMPT_FINGERPRINT = "b98028a7275fd467";

export const VERSION = `${MODEL}/p${PROMPT_VERSION}`;

/**
 * The Claude Code transport's own prompt version: its system prompt and arguments differ from
 * the API's, so an analysis made on one transport isn't served for the other. Bump it as above,
 * with CLAUDE_CODE_FINGERPRINT.
 */
export const CLAUDE_CODE_PROMPT_VERSION = 4;
export const CLAUDE_CODE_FINGERPRINT = "f75055e23d9c0abe";

export const CLAUDE_CODE_VERSION = `claude-code/${MODEL}/p${CLAUDE_CODE_PROMPT_VERSION}`;
