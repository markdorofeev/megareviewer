import { z } from "zod";

export const HostErrorKind = z.enum([
  "not-found",
  "unauthorized",
  "forbidden",
  "rate-limited",
  "too-large",
  "rejected",
  "network",
  "invalid-response",
  "unexpected",
]);
export type HostErrorKind = z.infer<typeof HostErrorKind>;

export const HostError = z
  .object({
    kind: HostErrorKind,
    message: z.string(),
    /** Set for rate-limited when the host says when to retry. */
    retryAfterSeconds: z.number().nonnegative().nullable(),
  })
  .readonly();
export type HostError = z.infer<typeof HostError>;

export const TicketErrorKind = z.enum([
  "not-configured",
  "unauthorized",
  "network",
  "invalid-response",
  "unexpected",
]);
export type TicketErrorKind = z.infer<typeof TicketErrorKind>;

export const TicketError = z
  .object({
    kind: TicketErrorKind,
    message: z.string(),
  })
  .readonly();
export type TicketError = z.infer<typeof TicketError>;

export const ModelErrorKind = z.enum([
  "refusal",
  "max-tokens",
  "invalid-output",
  "too-large",
  "rate-limited",
  "overloaded",
  "unauthorized",
  "network",
  /** The pass's read tool failed, or it used up its rounds of reading. */
  "reader",
  "unexpected",
]);
export type ModelErrorKind = z.infer<typeof ModelErrorKind>;

export const ModelError = z
  .object({
    kind: ModelErrorKind,
    message: z.string(),
  })
  .readonly();
export type ModelError = z.infer<typeof ModelError>;
