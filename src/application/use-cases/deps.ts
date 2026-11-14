import type { HostKind } from "../../domain/review/index.ts";
import type { AnalysisEvents } from "../events/index.ts";
import type {
  AnalysisStore,
  Clock,
  CodeParser,
  FileCache,
  GitHost,
  LocalCheckouts,
  Logger,
  ModelCatalog,
  PullRequestStatusSource,
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
  readonly fileCache: FileCache;
  readonly parser: CodeParser;
  /** Where unchanged callers are read from, when a checkout of the PR's repository is found. */
  readonly checkouts: LocalCheckouts;
  readonly events: AnalysisEvents;
  readonly clock: Clock;
  readonly logger: Logger;
}
