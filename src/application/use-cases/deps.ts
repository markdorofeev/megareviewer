import type { HostKind, RepoRef } from "../../domain/review/index.ts";
import type { AnalysisEvents } from "../events/index.ts";
import type {
  AnalysisStore,
  Clock,
  CodeParser,
  FileCache,
  GitHost,
  HarnessSource,
  HarnessStore,
  LocalCheckouts,
  Logger,
  ModelCatalog,
  PreferenceStore,
  PullRequestStatusSource,
  ReviewHistory,
  ReviewThreads,
  TicketSource,
} from "../ports/index.ts";

export interface AppDeps {
  /** Only the configured hosts. */
  readonly hosts: Partial<Record<HostKind, GitHost>>;
  /** The conversation on PRs' code, for the configured hosts. */
  readonly threads: Partial<Record<HostKind, ReviewThreads>>;
  /** Where PRs stand on the configured hosts: state, reviewers and CI. */
  readonly statuses: Partial<Record<HostKind, PullRequestStatusSource>>;
  readonly tickets: TicketSource;
  /** The models the reviewer can choose, asked by the status and before every model run. */
  readonly models: ModelCatalog;
  readonly store: AnalysisStore;
  /** What the reviewer values: their preferences, proposals, review signals and guideline switches. */
  readonly preferences: PreferenceStore;
  /** The reviewer's past comments, for the hosts that can read them. */
  readonly history: Partial<Record<HostKind, ReviewHistory>>;
  readonly fileCache: FileCache;
  /** Where a repository's harness is read from; null for one whose host can't give it. */
  readonly harnessSource: (repo: RepoRef) => HarnessSource | null;
  readonly harnessStore: HarnessStore;
  readonly parser: CodeParser;
  /** Where unchanged callers are read from, when a checkout of the PR's repository is found. */
  readonly checkouts: LocalCheckouts;
  readonly events: AnalysisEvents;
  readonly clock: Clock;
  readonly logger: Logger;
}
