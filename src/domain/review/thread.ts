import { z } from "zod";
import { Sha, Timestamp } from "./primitives.ts";
import { HostUser } from "./pull-request.ts";

/**
 * How much a comment matters, carried in its body as `**major:**` and the like, since hosts have
 * none. Nits have no level: they're fixed, not discussed.
 */
export const Severity = z.enum(["minor", "major", "blocking"]);
export type Severity = z.infer<typeof Severity>;

/** A host's ID for a thread: GitHub's node ID, or Bitbucket's first comment's ID. */
export const ThreadId = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
export type ThreadId = z.infer<typeof ThreadId>;

/** A host's ID for a comment: GitHub's node ID, or Bitbucket's comment ID. */
export const ThreadCommentId = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
export type ThreadCommentId = z.infer<typeof ThreadCommentId>;

export const ThreadComment = z
  .object({
    id: ThreadCommentId,
    author: HostUser,
    /** As the host has it: Markdown, untrusted. */
    body: z.string(),
    createdAt: Timestamp,
    /** The commit the comment was written on, when the host says. */
    originalCommit: Sha.nullable(),
  })
  .readonly();
export type ThreadComment = z.infer<typeof ThreadComment>;

/** What the host lets the current user do with a thread. */
export const ThreadPermissions = z.object({ reply: z.boolean(), resolve: z.boolean() }).readonly();
export type ThreadPermissions = z.infer<typeof ThreadPermissions>;

/** A conversation on lines of a file, as the host has it. */
export const ReviewThread = z
  .object({
    id: ThreadId,
    path: z.string().min(1),
    /** new: the lines are head-side line numbers; old: base-side ones. */
    side: z.enum(["new", "old"]),
    /** The last line it's on in the PR's current diff; null when the diff no longer has it. */
    line: z.number().int().positive().nullable(),
    /** The first line of a range, or null for one line. */
    startLine: z.number().int().positive().nullable(),
    /** The line it was written on, at its first comment's commit. */
    originalLine: z.number().int().positive().nullable(),
    resolved: z.boolean(),
    /** Who resolved it, when the host says. */
    resolvedBy: HostUser.nullable(),
    /** The code it was on has changed since. */
    outdated: z.boolean(),
    can: ThreadPermissions,
    /** The first comment, then the replies in the order they were written. */
    comments: z.array(ThreadComment).min(1).readonly(),
  })
  .readonly();
export type ReviewThread = z.infer<typeof ReviewThread>;

/** A PR's threads. */
export const ThreadList = z
  .object({
    threads: z.array(ReviewThread).readonly(),
  })
  .readonly();
export type ThreadList = z.infer<typeof ThreadList>;

/** The lines a thread covers, first to last, on its side; null when the diff no longer has them. */
export const threadLines = (
  thread: Pick<ReviewThread, "line" | "startLine">,
): { readonly start: number; readonly end: number } | null =>
  thread.line === null
    ? null
    : { start: Math.min(thread.startLine ?? thread.line, thread.line), end: thread.line };
