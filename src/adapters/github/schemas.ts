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

/** One alias per PR asked about; null when its repository isn't there or can't be read. */
export const GitHubOpenPullRequests = z.record(
  z.string(),
  z
    .object({
      pullRequest: z
        .object({
          state: z.string(),
          title: z.string(),
          url: HttpUrl,
          updatedAt: Timestamp,
          author: Account.nullable(),
        })
        .nullable(),
    })
    .nullable(),
);
export type GitHubOpenPullRequests = z.infer<typeof GitHubOpenPullRequests>;

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

export const GitHubErrorBody = z.object({
  message: z.string(),
  errors: z.array(z.union([z.string(), z.object({ message: z.string().optional() })])).optional(),
});

/** A comment's or resolver's account: null when it was deleted. `name` only for users. */
const GraphqlActor = z.object({ login: z.string().min(1), name: z.string().nullish() }).nullable();

export const GitHubThreadComment = z.object({
  id: z.string().min(1),
  body: z.string(),
  createdAt: Timestamp,
  author: GraphqlActor,
  /** null when the commit is gone, e.g. after a force push. */
  originalCommit: z.object({ oid: Sha }).nullable(),
});
export type GitHubThreadComment = z.infer<typeof GitHubThreadComment>;

export const GitHubReviewThread = z.object({
  id: z.string().min(1),
  isResolved: z.boolean(),
  isOutdated: z.boolean(),
  path: z.string().min(1),
  line: z.number().int().positive().nullable(),
  startLine: z.number().int().positive().nullable(),
  originalLine: z.number().int().positive().nullable(),
  diffSide: z.enum(["LEFT", "RIGHT"]),
  viewerCanResolve: z.boolean(),
  viewerCanUnresolve: z.boolean(),
  viewerCanReply: z.boolean(),
  resolvedBy: GraphqlActor,
  comments: z.object({ nodes: z.array(GitHubThreadComment) }),
});
export type GitHubReviewThread = z.infer<typeof GitHubReviewThread>;

export const GitHubThreadPage = z.object({
  repository: z.object({
    pullRequest: z.object({
      reviewThreads: z.object({
        pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
        nodes: z.array(GitHubReviewThread),
      }),
    }),
  }),
});
export type GitHubThreadPage = z.infer<typeof GitHubThreadPage>;

export const GitHubThreadReply = z.object({
  addPullRequestReviewThreadReply: z.object({ comment: GitHubThreadComment }),
});

/** What resolving or reopening returns. Nothing in it is read. */
export const GitHubThreadResolution = z.object({});

/** A review comment just posted. Nothing in it is read: the threads are read again. */
export const GitHubReviewCommentPosted = z.object({});

const GraphqlError = z.object({
  type: z.string().optional(),
  message: z.string(),
  path: z.array(z.union([z.string(), z.number()])).optional(),
});
export type GraphqlError = z.infer<typeof GraphqlError>;

/** An actor's login, and their name when it's a user. */
const Actor = z.object({ login: z.string().min(1), name: z.string().nullish() });

/** A field GitHub may refuse alone (a token without org read for teams) reads as empty. */
const nodesOf = <T extends z.ZodType>(node: T) =>
  z
    .object({ nodes: z.array(node.nullable()) })
    .nullable()
    .transform((connection) => (connection?.nodes ?? []).filter((one) => one !== null));

const RequestedReviewer = z.union([
  z.object({ __typename: z.literal("Team"), slug: z.string().min(1), name: z.string() }),
  z.object({ __typename: z.string(), login: z.string().min(1), name: z.string().nullish() }),
]);

const Review = z.object({ state: z.string(), author: Actor.nullable() });

const GitHubCheckContext = z.union([
  z.object({
    __typename: z.literal("CheckRun"),
    name: z.string().min(1),
    status: z.string(),
    conclusion: z.string().nullable(),
    detailsUrl: z.string().nullable(),
  }),
  z.object({
    __typename: z.literal("StatusContext"),
    context: z.string().min(1),
    state: z.string(),
    targetUrl: z.string().nullable(),
  }),
]);
export type GitHubCheckContext = z.infer<typeof GitHubCheckContext>;

export const GitHubStatusPullRequest = z.object({
  state: z.string(),
  isDraft: z.boolean(),
  reviewDecision: z.string().nullable(),
  author: z.object({ login: z.string() }).nullable(),
  reviewRequests: nodesOf(z.object({ requestedReviewer: RequestedReviewer.nullable() })),
  latestReviews: nodesOf(Review),
  latestOpinionatedReviews: nodesOf(Review),
});
export type GitHubStatusPullRequest = z.infer<typeof GitHubStatusPullRequest>;

/**
 * The status query's answer with GitHub's errors beside its data: a token that can read the PR
 * but not its checks gets the PR with the checks null and an error for them.
 */
export const GitHubStatusAnswer = z.object({
  data: z.object({
    repository: z
      .object({
        pullRequest: GitHubStatusPullRequest.nullable(),
        /** null when GitHub doesn't have the commit; without `statusCheckRollup` when refused. */
        object: z
          .object({
            statusCheckRollup: z
              .object({
                contexts: z.object({
                  totalCount: z.number().int().nonnegative(),
                  nodes: z.array(GitHubCheckContext.nullable()),
                }),
              })
              .nullish(),
          })
          .nullable(),
      })
      .nullable(),
  }),
  errors: z.array(GraphqlError),
});
export type GitHubStatusAnswer = z.infer<typeof GitHubStatusAnswer>;
