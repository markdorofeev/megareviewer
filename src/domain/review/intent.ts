import { z } from "zod";
import { HunkId } from "../diff/index.ts";
import { HttpUrl } from "./primitives.ts";

export const Ticket = z
  .object({
    key: z.string().min(1),
    url: HttpUrl,
    summary: z.string(),
    description: z.string(),
    type: z.string(),
    status: z.string(),
  })
  .readonly();
export type Ticket = z.infer<typeof Ticket>;

export const IntentSourceKind = z.enum(["description", "ticket", "commits", "branch"]);
export type IntentSourceKind = z.infer<typeof IntentSourceKind>;

export const StatedIntent = z
  .object({
    summary: z.string(),
    sources: z
      .array(
        z
          .object({
            kind: IntentSourceKind,
            /** The ticket key for a ticket source, otherwise null. */
            ref: z.string().nullable(),
          })
          .readonly(),
      )
      .readonly(),
  })
  .readonly();
export type StatedIntent = z.infer<typeof StatedIntent>;

export const InferredIntent = z
  .object({
    summary: z.string(),
    behaviorChanges: z.array(z.string()).readonly(),
  })
  .readonly();
export type InferredIntent = z.infer<typeof InferredIntent>;

export const IntentMismatchKind = z.enum(["unrequested", "missing", "contradicts"]);
export type IntentMismatchKind = z.infer<typeof IntentMismatchKind>;

export const IntentMismatch = z
  .object({
    kind: IntentMismatchKind,
    description: z.string(),
    hunkIds: z.array(HunkId).readonly(),
  })
  .readonly();
export type IntentMismatch = z.infer<typeof IntentMismatch>;

export const Intent = z
  .object({
    /** null when there's no description, no tickets and no meaningful commit messages. */
    stated: StatedIntent.nullable(),
    inferred: InferredIntent,
    mismatches: z.array(IntentMismatch).readonly(),
  })
  .readonly();
export type Intent = z.infer<typeof Intent>;
