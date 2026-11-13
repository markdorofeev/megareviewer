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
  ModelAvailability,
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
  /** Whether `model` can run its passes now. Asked by the status and before every model run. */
  readonly modelAvailability: () => Promise<ModelAvailability>;
  readonly store: AnalysisStore;
  readonly fileCache: FileCache;
  readonly parser: CodeParser;
  /** Where unchanged callers are read from, when a checkout of the PR's repository is found. */
  readonly checkouts: LocalCheckouts;
  readonly events: AnalysisEvents;
  readonly clock: Clock;
  readonly logger: Logger;
}
