import type { HostKind } from "../../domain/review/index.ts";
import type { AnalysisEvents } from "../events/index.ts";
import type {
  AnalysisModel,
  AnalysisStore,
  Clock,
  CodeParser,
  FileCache,
  GitHost,
  LocalCheckouts,
  Logger,
  ReviewThreads,
  TicketSource,
} from "../ports/index.ts";

export interface AppDeps {
  /** Only the configured hosts. */
  readonly hosts: Partial<Record<HostKind, GitHost>>;
  /** The conversation on PRs' code, for the configured hosts. */
  readonly threads: Partial<Record<HostKind, ReviewThreads>>;
  readonly tickets: TicketSource;
  readonly model: AnalysisModel;
  /** Whether the model passes run. Off, the analysis is built by deterministic code alone. */
  readonly modelEnabled: boolean;
  readonly store: AnalysisStore;
  readonly fileCache: FileCache;
  readonly parser: CodeParser;
  /** Where unchanged callers are read from, when a checkout of the PR's repository is found. */
  readonly checkouts: LocalCheckouts;
  readonly events: AnalysisEvents;
  readonly clock: Clock;
  readonly logger: Logger;
}
