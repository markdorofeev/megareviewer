import { z } from "zod";
import { HttpUrl, Sha } from "../../domain/review/index.ts";

// Only the fields the adapter reads. Zod drops the rest.

/** Bitbucket's timestamps carry an offset and microseconds; the domain wants UTC with a Z. */
const BitbucketTimestamp = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());

/** The PR object abbreviates commit hashes to 12 characters. */
const ShortHash = z.string().regex(/^[0-9a-f]{7,40}$/);

export const BitbucketAccount = z.object({
  uuid: z.string().min(1),
  display_name: z.string(),
});
export type BitbucketAccount = z.infer<typeof BitbucketAccount>;

const Branch = z.object({ name: z.string().min(1) });
/** null when the source branch or fork was deleted. */
const CommitRef = z.object({ hash: ShortHash }).nullable();

export const BitbucketPullRequest = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  description: z.string().nullish(),
  summary: z.object({ raw: z.string().nullish() }).nullish(),
  /** Missing for some deleted accounts. */
  author: BitbucketAccount.nullish(),
  source: z.object({ branch: Branch, commit: CommitRef }),
  destination: z.object({
    branch: Branch,
    commit: CommitRef,
    repository: z.object({ full_name: z.string().regex(/^[^/]+\/[^/]+$/) }),
  }),
  links: z.object({ html: z.object({ href: HttpUrl }) }),
  created_on: BitbucketTimestamp,
  updated_on: BitbucketTimestamp,
});
export type BitbucketPullRequest = z.infer<typeof BitbucketPullRequest>;

export const BitbucketCommit = z.object({
  hash: Sha,
  message: z.string(),
  author: z.object({
    /** The git author, "Name <email>". */
    raw: z.string().optional(),
    /** The Bitbucket account the commit's email belongs to, if any. */
    user: BitbucketAccount.optional(),
  }),
});
export type BitbucketCommit = z.infer<typeof BitbucketCommit>;

/** A commit lookup or the merge base: both return a commit with its full hash. */
export const BitbucketCommitHash = z.object({ hash: Sha });

export const BitbucketRepository = z.object({ slug: z.string().min(1) });

export const BitbucketComment = z.object({ id: z.number().int() });

/** What approving or requesting changes returns. Nothing in it is read. */
export const BitbucketParticipant = z.object({});

/** One page of a paginated list. `next` is absent on the last page. */
export const BitbucketPage = <T extends z.ZodType>(item: T) =>
  z.object({ values: z.array(item), next: z.string().optional() });

/** The JSON body of most 4xx and 5xx responses. Some, like a missing PR's 404, are plain text. */
export const BitbucketErrorBody = z.object({
  error: z.object({
    message: z.string(),
    detail: z.unknown().optional(),
  }),
});

/** The `detail` of a 403 for a token that lacks scopes. */
export const MissingScopesDetail = z.object({ required: z.array(z.string()) });

/** A comment on a PR: one with `inline` starts a thread on code, one with `parent` replies. */
export const BitbucketThreadComment = z.object({
  id: z.number().int().positive(),
  content: z.object({ raw: z.string().nullish() }),
  /** Missing for some deleted accounts. */
  user: BitbucketAccount.nullish(),
  created_on: BitbucketTimestamp,
  deleted: z.boolean().optional(),
  parent: z.object({ id: z.number().int().positive() }).optional(),
  inline: z
    .object({
      path: z.string().min(1),
      /** The old file's line, for a comment on a deleted line. */
      from: z.number().int().positive().nullish(),
      /** The new file's line. */
      to: z.number().int().positive().nullish(),
      start_from: z.number().int().positive().nullish(),
      start_to: z.number().int().positive().nullish(),
      outdated: z.boolean().optional(),
    })
    .optional(),
  /** Set once the thread is resolved. */
  resolution: z
    .object({ user: BitbucketAccount.nullish(), created_on: BitbucketTimestamp.optional() })
    .nullish(),
});
export type BitbucketThreadComment = z.infer<typeof BitbucketThreadComment>;

export const BitbucketRepositoryPermission = z.object({
  permission: z.enum(["read", "write", "admin", "none"]).or(z.string()),
});

/** The PR's source branch and repository, for a commit on it. */
export const BitbucketPullRequestSource = z.object({
  source: z.object({
    branch: Branch,
    commit: CommitRef,
    repository: z.object({ full_name: z.string().regex(/^[^/]+\/[^/]+$/) }).nullish(),
  }),
  destination: z.object({
    repository: z.object({ full_name: z.string().regex(/^[^/]+\/[^/]+$/) }),
  }),
});
