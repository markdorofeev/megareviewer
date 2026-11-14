import {
  type HostKind,
  HostKind as HostKinds,
  type HostUser,
  type ModelOptions,
  type PullRequestRef,
  type PullRequestSummary,
  type ReviewActivity,
} from "../../domain/review/index.ts";
import { ok } from "../../domain/shared/index.ts";
import type { AppDeps } from "./deps.ts";

export interface PullRequestList {
  /** Most recently updated first. */
  readonly items: readonly PullRequestSummary[];
  /** Hosts that failed to list; the others' PRs are still in items. */
  readonly errors: readonly { readonly host: HostKind; readonly message: string }[];
}

export interface HostStatus {
  readonly configured: boolean;
  readonly user: HostUser | null;
  readonly error: string | null;
}

export interface Status {
  readonly version: string;
  readonly hosts: Readonly<Record<HostKind, HostStatus>>;
  readonly jira: { readonly configured: boolean };
  /** Every model option, enabled or not, and the one a run without a choice uses. */
  readonly model: ModelOptions;
}

const HOSTS: readonly HostKind[] = HostKinds.options;

/** The page shows 26 weeks; one more covers any time zone's edge of the first day. */
export const ACTIVITY_WEEKS = 27;

/** PRs opened here before that are looked up on their hosts, so the lookup stays small. */
export const OPENED_PULL_REQUESTS = 50;

const prKey = ({ repo, number }: PullRequestRef): string =>
  `${repo.host}/${repo.owner}/${repo.repo}#${number}`;

export const createStatusUseCases = (deps: AppDeps, version: string) => ({
  /**
   * PRs to review and the user's own, from every configured host. PRs opened here before
   * that are still open join the PRs to review, unless a host already lists them.
   */
  async listPullRequests(): Promise<PullRequestList> {
    const opened = await deps.store.listAnalyzedPullRequests(OPENED_PULL_REQUESTS);
    const listed = await Promise.all(
      HOSTS.flatMap((host) => {
        const gitHost = deps.hosts[host];
        if (gitHost === undefined) return [];
        const refs = opened.filter((ref) => ref.repo.host === host);
        return [
          Promise.all([
            gitHost.listPullRequests(),
            refs.length === 0 ? ok([]) : gitHost.getOpenPullRequests(refs),
          ]).then(([result, reopened]) => ({ host, result, reopened })),
        ];
      }),
    );

    const items: PullRequestSummary[] = [];
    const seen = new Set<string>();
    const add = (summaries: readonly PullRequestSummary[]) => {
      for (const summary of summaries) {
        if (seen.has(prKey(summary.ref))) continue;
        seen.add(prKey(summary.ref));
        items.push(summary);
      }
    };
    // The hosts' own lists first, so a PR they list keeps the role they gave it.
    for (const { result } of listed) if (result.ok) add(result.value);
    for (const { reopened } of listed) if (reopened.ok) add(reopened.value);

    return {
      items: items.sort((a, b) =>
        a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0,
      ),
      // One per host: its list's failure, else the lookup's.
      errors: listed.flatMap(({ host, result, reopened }) => {
        const failed = !result.ok ? result : !reopened.ok ? reopened : null;
        return failed === null ? [] : [{ host, message: failed.error.message }];
      }),
    };
  },

  /** What the reviewer posted from megareviewer in the last ACTIVITY_WEEKS weeks. */
  async getReviewActivity(): Promise<ReviewActivity> {
    const since = Date.parse(deps.clock.now()) - ACTIVITY_WEEKS * 7 * 24 * 60 * 60 * 1000;
    return deps.store.getReviewActivity(new Date(since).toISOString());
  },

  async getStatus(): Promise<Status> {
    const hostStatus = async (host: HostKind): Promise<HostStatus> => {
      const gitHost = deps.hosts[host];
      if (gitHost === undefined) return { configured: false, user: null, error: null };
      const user = await gitHost.currentUser();
      return user.ok
        ? { configured: true, user: user.value, error: null }
        : { configured: true, user: null, error: user.error.message };
    };
    const [github, bitbucket, model] = await Promise.all([
      hostStatus("github"),
      hostStatus("bitbucket"),
      deps.models.options(),
    ]);
    return {
      version,
      hosts: { github, bitbucket },
      jira: { configured: deps.tickets.configured },
      model,
    };
  },
});
