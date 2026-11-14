import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { Hono } from "hono";
import {
  createBitbucketHost,
  createBitbucketReviewThreads,
  createBitbucketStatusSource,
} from "../adapters/bitbucket/index.ts";
import { createGitCheckouts } from "../adapters/git/index.ts";
import {
  createGitHubHost,
  createGitHubReviewThreads,
  createGitHubStatusSource,
} from "../adapters/github/index.ts";
import { createHttpApp } from "../adapters/http/index.ts";
import { createJiraTicketSource, createUnconfiguredTicketSource } from "../adapters/jira/index.ts";
import { createRunClaude, createRunCodex } from "../adapters/model/index.ts";
import { openSqliteAnalysisStore, type SqliteAnalysisStore } from "../adapters/sqlite/index.ts";
import { createTreeSitterCodeParser } from "../adapters/treesitter/index.ts";
import { createAnalysisEvents } from "../application/events/index.ts";
import type {
  Clock,
  GitHost,
  Logger,
  PullRequestStatusSource,
  ReviewThreads,
  TicketSource,
} from "../application/ports/index.ts";
import {
  retryingGitHost,
  retryingReviewThreads,
  retryingStatusSource,
} from "../application/retries/index.ts";
import { type AppDeps, createUseCases, type UseCases } from "../application/use-cases/index.ts";
import type { HostKind, ModelOptions } from "../domain/review/index.ts";
import { err, ok, type Result } from "../domain/shared/index.ts";
import type { Config } from "./config.ts";
import { createModelCatalog } from "./model-access.ts";

export interface ComposeOptions {
  /** Holds the tree-sitter runtime, the grammars and their queries. */
  readonly grammarsDir: string;
  /** The built UI, or null when there is none (in development, Vite serves it). */
  readonly staticDir: string | null;
  /** Where unchanged callers are read from, when it's a checkout with the PR's head commit. */
  readonly checkoutDir: string;
  readonly version: string;
  readonly logger: Logger;
}

export interface Composition {
  readonly useCases: UseCases;
  readonly sessionToken: string;
  /** The models "Request AI review" can run on, and the default. */
  modelOptions(): Promise<ModelOptions>;
  /** The HTTP app for a server listening on `port`, which its Host check needs. */
  app(port: number): Hono;
  /** Closes the database. Safe to call more than once. */
  close(): Promise<void>;
}

export const systemClock: Clock = { now: () => new Date().toISOString() };

/** 32 random bytes: the UI's tab gets it in its URL, nothing else on the machine knows it. */
export const newSessionToken = (): string => randomBytes(32).toString("base64url");

export const allowedHosts = (port: number): string[] => [`127.0.0.1:${port}`, `localhost:${port}`];

export const createHosts = (
  config: Pick<Config, "github" | "bitbucket">,
  options: { readonly version: string; readonly clock: Clock; readonly logger: Logger },
): Partial<Record<HostKind, GitHost>> => {
  const { github, bitbucket } = config;
  const { clock, logger } = options;
  const retrying = (host: GitHost) => retryingGitHost(host, { sleep, logger });
  return {
    ...(github !== null && {
      github: retrying(
        createGitHubHost({ token: github.token, version: options.version, clock, logger }),
      ),
    }),
    ...(bitbucket !== null && {
      bitbucket: retrying(createBitbucketHost({ ...bitbucket, clock, logger })),
    }),
  };
};

/** The conversation on PRs' code, for the configured hosts; reads retried as the hosts' are. */
export const createReviewThreads = (
  config: Pick<Config, "github" | "bitbucket">,
  options: { readonly version: string; readonly clock: Clock; readonly logger: Logger },
): Partial<Record<HostKind, ReviewThreads>> => {
  const { github, bitbucket } = config;
  const { clock, logger } = options;
  const retrying = (threads: ReviewThreads) => retryingReviewThreads(threads, { sleep, logger });
  return {
    ...(github !== null && {
      github: retrying(
        createGitHubReviewThreads({ token: github.token, version: options.version, clock, logger }),
      ),
    }),
    ...(bitbucket !== null && {
      bitbucket: retrying(
        createBitbucketReviewThreads({
          username: bitbucket.username,
          password: bitbucket.password,
          logger,
        }),
      ),
    }),
  };
};

/** Where PRs stand on the configured hosts; reads retried as the hosts' are. */
export const createStatusSources = (
  config: Pick<Config, "github" | "bitbucket">,
  options: { readonly version: string; readonly clock: Clock; readonly logger: Logger },
): Partial<Record<HostKind, PullRequestStatusSource>> => {
  const { github, bitbucket } = config;
  const { clock, logger } = options;
  const retrying = (source: PullRequestStatusSource) =>
    retryingStatusSource(source, { sleep, logger });
  return {
    ...(github !== null && {
      github: retrying(
        createGitHubStatusSource({ token: github.token, version: options.version, clock, logger }),
      ),
    }),
    ...(bitbucket !== null && {
      bitbucket: retrying(
        createBitbucketStatusSource({
          username: bitbucket.username,
          password: bitbucket.password,
          logger,
        }),
      ),
    }),
  };
};

export const createTicketSource = (config: Pick<Config, "jira">, logger: Logger): TicketSource =>
  config.jira === null
    ? createUnconfiguredTicketSource()
    : createJiraTicketSource({ ...config.jira, logger });

/** Everything after the adapters, shared by the real composition and fake mode. */
export const assemble = async (
  deps: Omit<AppDeps, "events">,
  options: {
    readonly staticDir: string | null;
    readonly version: string;
    readonly sessionToken?: string;
    readonly close: () => Promise<void>;
  },
): Promise<Composition> => {
  const events = createAnalysisEvents();
  const useCases = createUseCases({ ...deps, events }, { version: options.version });
  const interrupted = await useCases.recoverInterruptedAnalyses();
  if (interrupted > 0) {
    deps.logger.info("Marked analyses interrupted by an earlier exit as failed", {
      count: interrupted,
    });
  }
  const sessionToken = options.sessionToken ?? newSessionToken();
  return {
    useCases,
    sessionToken,
    modelOptions: () => deps.models.options(),
    app: (port) =>
      createHttpApp({
        useCases,
        events,
        sessionToken,
        allowedHosts: allowedHosts(port),
        staticDir: options.staticDir,
        logger: deps.logger,
      }),
    close: options.close,
  };
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Wires the real adapters into the use cases. The only place that knows them. Fails with a
 * message for the user when the home directory or the database can't be opened.
 */
export const compose = async (
  config: Config,
  options: ComposeOptions,
): Promise<Result<Composition, string>> => {
  const { logger } = options;
  const clock = systemClock;
  // Aborted on close, which kills the passes still running.
  const running = new AbortController();
  const models = createModelCatalog({
    runClaude: createRunClaude({ signal: running.signal }),
    runCodex: createRunCodex({ signal: running.signal }),
    logger,
  });
  try {
    mkdirSync(config.home, { recursive: true, mode: 0o700 });
  } catch (error) {
    return err(`Can't create ${config.home}: ${messageOf(error)}`);
  }

  const path = join(config.home, "db.sqlite");
  let store: SqliteAnalysisStore;
  try {
    store = openSqliteAnalysisStore({ path, clock, logger });
  } catch (error) {
    // A database from a newer megareviewer lands here, with a message saying to upgrade.
    return err(`Can't open the database at ${path}: ${messageOf(error)}`);
  }

  try {
    return ok(
      await assemble(
        {
          hosts: createHosts(config, { version: options.version, clock, logger }),
          threads: createReviewThreads(config, { version: options.version, clock, logger }),
          statuses: createStatusSources(config, { version: options.version, clock, logger }),
          tickets: createTicketSource(config, logger),
          models,
          store,
          fileCache: store,
          checkouts: createGitCheckouts({ dir: options.checkoutDir }),
          parser: await createTreeSitterCodeParser({ grammarsDir: options.grammarsDir }),
          clock,
          logger,
        },
        {
          staticDir: options.staticDir,
          version: options.version,
          close: async () => {
            running.abort();
            store.close();
          },
        },
      ),
    );
  } catch (error) {
    store.close();
    throw error;
  }
};
