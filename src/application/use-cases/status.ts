import {
  type HostKind,
  HostKind as HostKinds,
  type HostUser,
  type PullRequestSummary,
} from "../../domain/review/index.ts";
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
  readonly model: { readonly enabled: boolean };
}

const HOSTS: readonly HostKind[] = HostKinds.options;

export const createStatusUseCases = (deps: AppDeps, version: string) => ({
  /** PRs to review and the user's own, from every configured host. */
  async listPullRequests(): Promise<PullRequestList> {
    const listed = await Promise.all(
      HOSTS.flatMap((host) => {
        const gitHost = deps.hosts[host];
        return gitHost === undefined
          ? []
          : [gitHost.listPullRequests().then((result) => ({ host, result }))];
      }),
    );
    return {
      items: listed
        .flatMap(({ result }) => (result.ok ? result.value : []))
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0)),
      errors: listed.flatMap(({ host, result }) =>
        result.ok ? [] : [{ host, message: result.error.message }],
      ),
    };
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
    const [github, bitbucket] = await Promise.all([hostStatus("github"), hostStatus("bitbucket")]);
    return {
      version,
      hosts: { github, bitbucket },
      jira: { configured: deps.tickets.configured },
      model: { enabled: deps.modelEnabled },
    };
  },
});
