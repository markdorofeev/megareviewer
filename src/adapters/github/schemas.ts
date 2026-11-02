import { z } from "zod";
import { HttpUrl, Sha, Timestamp } from "../../domain/review/index.ts";

// Only the fields the adapter reads. Zod drops the rest.

const Account = z.object({ login: z.string().min(1) });

export const GitHubUser = z.object({
  login: z.string().min(1),
  name: z.string().nullable(),
});
export type GitHubUser = z.infer<typeof GitHubUser>;

const BranchTip = z.object({ ref: z.string().min(1), sha: Sha });

export const GitHubPullRequest = z.object({
  html_url: HttpUrl,
  title: z.string(),
  body: z.string().nullable(),
  /** null when the author's account was deleted. */
  user: Account.nullable(),
  head: BranchTip,
  base: BranchTip,
  created_at: Timestamp,
  updated_at: Timestamp,
});
export type GitHubPullRequest = z.infer<typeof GitHubPullRequest>;

export const GitHubCommit = z.object({
  sha: Sha,
  commit: z.object({
    message: z.string(),
    author: z.object({ name: z.string() }).nullable(),
  }),
  /** The GitHub account the commit's email belongs to, if any. */
  author: Account.nullable(),
});
export type GitHubCommit = z.infer<typeof GitHubCommit>;

export const GitHubComparison = z.object({
  merge_base_commit: z.object({ sha: Sha }),
});

/** Octokit returns text for responses with a UTF-8 charset and an ArrayBuffer otherwise. */
export const GitHubText = z.union([
  z.string(),
  z.instanceof(ArrayBuffer).transform((buffer) => new TextDecoder().decode(buffer)),
]);

/** One file of a GraphQL batch read: a Blob, another kind of object (a submodule), or nothing. */
const GitHubObject = z.object({
  __typename: z.string(),
  text: z.string().nullable().optional(),
  isBinary: z.boolean().nullable().optional(),
  isTruncated: z.boolean().optional(),
});

/** The data of a batch read: the files under aliases f0, f1, …, null where there is none. */
export const GitHubBlobs = z.object({
  repository: z.record(z.string(), GitHubObject.nullable()),
});
export type GitHubBlobs = z.infer<typeof GitHubBlobs>;

export const GitHubSearchResult = z.object({
  total_count: z.number().int().nonnegative(),
  incomplete_results: z.boolean(),
  items: z.array(
    z.object({
      number: z.number().int().positive(),
      title: z.string(),
      html_url: HttpUrl,
      user: Account.nullable(),
      updated_at: Timestamp,
      /** `https://api.github.com/repos/{owner}/{repo}` */
      repository_url: z.string().regex(/\/repos\/[^/]+\/[^/]+$/),
    }),
  ),
});
export type GitHubSearchResult = z.infer<typeof GitHubSearchResult>;

export const GitHubReview = z.object({
  id: z.number().int(),
  html_url: HttpUrl,
  submitted_at: Timestamp.nullable(),
});

export const GitHubReviewComment = z.object({
  id: z.number().int(),
  path: z.string(),
  body: z.string(),
  // Optional in GitHub's schema: matched only when present.
  line: z.number().int().nullable().optional(),
  side: z.enum(["LEFT", "RIGHT"]).nullable().optional(),
});
export type GitHubReviewComment = z.infer<typeof GitHubReviewComment>;

/** The body of a 4xx or 5xx response. */
export const GitHubErrorBody = z.object({
  message: z.string(),
  errors: z.array(z.union([z.string(), z.object({ message: z.string().optional() })])).optional(),
});
