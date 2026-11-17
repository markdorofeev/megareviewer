import {
  type HostError,
  type HostKind,
  type PastComment,
  type RepoRef,
  sameRepo,
} from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import type { ReviewerComments, ReviewHistory } from "../ports/index.ts";

/**
 * The reviewer's comments as given, each on a pull request they reviewed. `failWith` makes the
 * next read fail; `calls` keeps what was asked.
 */
export class FakeReviewHistory implements ReviewHistory {
  readonly host: HostKind;
  readonly calls: { readonly repo: RepoRef; readonly pullRequests: number }[] = [];
  private readonly comments: readonly PastComment[];
  private failure: HostError | null = null;

  constructor(options: { readonly host: HostKind; readonly comments?: readonly PastComment[] }) {
    this.host = options.host;
    this.comments = options.comments ?? [];
  }

  failWith(error: HostError): void {
    this.failure = error;
  }

  async getReviewerComments(
    repo: RepoRef,
    options: { readonly pullRequests: number },
  ): Promise<Result<ReviewerComments, HostError>> {
    this.calls.push({ repo, pullRequests: options.pullRequests });
    if (this.failure !== null) {
      const failure = this.failure;
      this.failure = null;
      return err(failure);
    }
    const newestFirst = this.comments
      .filter((comment) => sameRepo(comment.pullRequest.repo, repo))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    // The pull requests of the newest comments stand in for the most recently updated ones.
    const read = [...new Set(newestFirst.map((comment) => comment.pullRequest.number))].slice(
      0,
      options.pullRequests,
    );
    return ok({
      comments: structuredClone(
        newestFirst.filter((comment) => read.includes(comment.pullRequest.number)),
      ),
      pullRequests: read.length,
    });
  }
}
