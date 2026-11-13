import type { HostError } from "../../domain/review/index.ts";

/**
 * The HTTP API's error codes (`ErrorCode` in contracts/), repeated here because the application
 * layer can't import the contract. The HTTP adapter checks at compile time that the two match.
 */
export type ErrorCode =
  | "bad-request"
  | "unsupported-url"
  | "host-not-configured"
  | "unauthorized"
  | "not-found"
  | "stale-analysis"
  | "analysis-not-complete"
  | "host-error"
  | "model-error"
  | "model-unavailable"
  | "internal";

export interface UseCaseError {
  readonly code: ErrorCode;
  readonly message: string;
}

export const appError = (code: ErrorCode, message: string): UseCaseError => ({ code, message });

/** A host's "not found" stays one; anything else is the host's fault, not the request's. */
export const fromHostError = (error: HostError): UseCaseError =>
  appError(error.kind === "not-found" ? "not-found" : "host-error", error.message);
