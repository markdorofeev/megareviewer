import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig as loadAnthropicConfig } from "@anthropic-ai/sdk/core/credentials";
import type { Hono } from "hono";
import { createBitbucketHost } from "../adapters/bitbucket/index.ts";
import { createClaudeAnalysisModel } from "../adapters/claude/index.ts";
import { createGitHubHost } from "../adapters/github/index.ts";
import { createHttpApp } from "../adapters/http/index.ts";
import { createJiraTicketSource, createUnconfiguredTicketSource } from "../adapters/jira/index.ts";
import { openSqliteAnalysisStore, type SqliteAnalysisStore } from "../adapters/sqlite/index.ts";
import { createTreeSitterCodeParser } from "../adapters/treesitter/index.ts";
import { createAnalysisEvents } from "../application/events/index.ts";
import type {
  AnalysisModel,
  Clock,
  GitHost,
  Logger,
  TicketSource,
} from "../application/ports/index.ts";
import { retryingGitHost } from "../application/retries/index.ts";
import { type AppDeps, createUseCases, type UseCases } from "../application/use-cases/index.ts";
import type { HostKind } from "../domain/review/index.ts";
import { err, ok, type Result } from "../domain/shared/index.ts";
import type { Config } from "./config.ts";

export interface ComposeOptions {
  /** Holds the tree-sitter runtime, the grammars and their queries. */
  readonly grammarsDir: string;
  /** The built UI, or null when there is none (in development, Vite serves it). */
  readonly staticDir: string | null;
  /** Run the model passes (`--ai`). They need Anthropic credentials. */
  readonly ai: boolean;
  readonly version: string;
  readonly logger: Logger;
}

export interface Composition {
  readonly useCases: UseCases;
  readonly sessionToken: string;
  readonly modelEnabled: boolean;
  /** The HTTP app for a server listening on `port`, which its Host check needs. */
  app(port: number): Hono;
  /** Closes the database. Safe to call more than once. */
  close(): Promise<void>;
}

export const systemClock: Clock = { now: () => new Date().toISOString() };

/** 32 random bytes: the UI's tab gets it in its URL, nothing else on the machine knows it. */
export const newSessionToken = (): string => randomBytes(32).toString("base64url");

export const allowedHosts = (port: number): string[] => [`127.0.0.1:${port}`, `localhost:${port}`];

export const NO_ANTHROPIC_CREDENTIALS =
  "--ai needs Anthropic credentials. Set ANTHROPIC_API_KEY or run `ant auth login`, then restart megareviewer --ai.";

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

export const createTicketSource = (config: Pick<Config, "jira">, logger: Logger): TicketSource =>
  config.jira === null
    ? createUnconfiguredTicketSource()
    : createJiraTicketSource({ ...config.jira, logger });

/**
 * Whether the SDK will find credentials: an API key or auth token from the environment, or an
 * `ant auth login` profile. Without them its first request throws, which would be a bug report
 * instead of a fix hint.
 */
export const anthropicConfigured = async (client: Anthropic, logger: Logger): Promise<boolean> => {
  if (client.apiKey !== null || client.authToken !== null) return true;
  try {
    return (await loadAnthropicConfig()) !== null;
  } catch (error) {
    logger.warn("Couldn't read the Anthropic profile", { error });
    return false;
  }
};

/** Fails every pass with a fix hint, so analyses fail with a model error the UI can show. */
export const unconfiguredModel = (version: string): AnalysisModel => {
  const fail = async () =>
    err({ kind: "unauthorized" as const, message: NO_ANTHROPIC_CREDENTIALS });
  return { version, checkSize: fail, intent: fail, risk: fail, decisions: fail, tour: fail };
};

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
    modelEnabled: deps.modelEnabled,
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
 * message for the user when the home directory or the database can't be opened, or when `--ai`
 * asks for the model and there are no Anthropic credentials.
 */
export const compose = async (
  config: Config,
  options: ComposeOptions,
): Promise<Result<Composition, string>> => {
  const { logger } = options;
  const clock = systemClock;
  const client = new Anthropic();
  const modelConfigured = await anthropicConfigured(client, logger);
  if (options.ai && !modelConfigured) return err(NO_ANTHROPIC_CREDENTIALS);
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
    const claude = createClaudeAnalysisModel({ client, logger });
    return ok(
      await assemble(
        {
          hosts: createHosts(config, { version: options.version, clock, logger }),
          tickets: createTicketSource(config, logger),
          model: modelConfigured ? claude : unconfiguredModel(claude.version),
          modelEnabled: options.ai,
          store,
          fileCache: store,
          checkouts: { find: async () => null },
          parser: await createTreeSitterCodeParser({ grammarsDir: options.grammarsDir }),
          clock,
          logger,
        },
        {
          staticDir: options.staticDir,
          version: options.version,
          close: async () => store.close(),
        },
      ),
    );
  } catch (error) {
    store.close();
    throw error;
  }
};
