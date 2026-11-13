import type { ApiError, ApiErrorCode } from "./errors.ts";

/** A sentence from a server message, which may lack the final period. */
const sentence = (text: string): string => {
  const trimmed = text.trim();
  return trimmed === "" || /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

/** What the reviewer reads for each error, given the server's message. */
const MESSAGES: Readonly<Record<ApiErrorCode, (message: string) => string>> = {
  "bad-request": (message) => `megareviewer rejected the request: ${sentence(message)}`,
  "unsupported-url": () => "Only github.com and bitbucket.org pull request links are supported.",
  "host-not-configured": (message) =>
    `${sentence(message)} Run npx megareviewer doctor to see how to set it up.`,
  unauthorized: () =>
    "This session has ended. Open megareviewer from the link printed in your terminal.",
  "not-found": (message) => sentence(message),
  "stale-analysis": () => "The pull request has new commits since this analysis.",
  "analysis-not-complete": () => "The analysis isn't complete yet.",
  "host-error": (message) => `The git host returned an error: ${sentence(message)}`,
  "model-error": (message) => `The model call failed: ${sentence(message)}`,
  "model-unavailable": (message) => `Claude can't run: ${sentence(message)}`,
  internal: (message) => sentence(message) || "Something went wrong.",
  unreachable: (message) => sentence(message),
};

export const errorMessage = (error: ApiError): string => MESSAGES[error.code](error.message);
