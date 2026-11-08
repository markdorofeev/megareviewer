import { MODEL } from "./request.ts";

/**
 * Bump whenever a prompt, the input rendering, the output schema or the request settings
 * change, and set PROMPT_FINGERPRINT to the value the version test prints. The version is part
 * of the analysis cache key, so a stale one would serve analyses made with the old prompts.
 */
export const PROMPT_VERSION = 3;
export const PROMPT_FINGERPRINT = "a368dde895dfadf0";

export const VERSION = `${MODEL}/p${PROMPT_VERSION}`;
