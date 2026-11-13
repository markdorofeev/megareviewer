import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig as loadAnthropicConfig } from "@anthropic-ai/sdk/core/credentials";
import type { Hono } from "hono";
import { createBitbucketHost, createBitbucketReviewThreads } from "../adapters/bitbucket/index.ts";
import {
  type ClaudeCodeStatus,
  claudeCodeStatus,
  compareVersions,
  createClaudeAnalysisModel,
  createClaudeCodeAnalysisModel,
  createRunClaude,
  MIN_CLAUDE_CODE_VERSION,
  planName,
  type RunClaude,
} from "../adapters/claude/index.ts";
import { createGitCheckouts } from "../adapters/git/index.ts";
import { createGitHubHost, createGitHubReviewThreads } from "../adapters/github/index.ts";
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
  ReviewThreads,
  TicketSource,
} from "../application/ports/index.ts";
import { retryingGitHost, retryingReviewThreads } from "../application/retries/index.ts";
import { type AppDeps, createUseCases, type UseCases } from "../application/use-cases/index.ts";
import type { HostKind, ModelBilling } from "../domain/review/index.ts";
import { err, ok, type Result } from "../domain/shared/index.ts";
import type { AiVia } from "./args.ts";
import type { Config } from "./config.ts";

export interface ComposeOptions {
  /** Holds the tree-sitter runtime, the grammars and their queries. */
  readonly grammarsDir: string;
  /** The built UI, or null when there is none (in development, Vite serves it). */
  readonly staticDir: string | null;
  /** Run the model passes (`--ai`), and how they reach Claude; null leaves them off. */
  readonly ai: AiVia | null;
  /** Where unchanged callers are read from, when it's a checkout with the PR's head commit. */
  readonly checkoutDir: string;
  readonly version: string;
  readonly logger: Logger;
}

export interface Composition {
  readonly useCases: UseCases;
  readonly sessionToken: string;
  readonly modelEnabled: boolean;
  /** How the passes reach Claude, and who pays; null when they're off. */
  readonly transport: ModelTransport | null;
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
  "The Anthropic API needs credentials. Set ANTHROPIC_API_KEY or run `ant auth login`, then restart megareviewer.";

export type ModelTransport =
  | {
      readonly kind: "claude-code";
      readonly version: string;
      readonly plan: string | null;
      readonly billing: ModelBilling;
    }
  | { readonly kind: "api" };

/** What the startup line says ran, and who pays for it. */
export const describeTransport = (transport: ModelTransport): string =>
  transport.kind === "api"
    ? "Anthropic API, billed to your account"
    : transport.billing === "plan"
      ? `Claude Code, on ${planName(transport.plan)}`
      : "Claude Code, billed to your Anthropic Console account";

/** Why Claude Code can't run the passes, or null when it can. */
export const claudeCodeProblem = (status: ClaudeCodeStatus): string | null => {
  switch (status.state) {
    case "not-installed":
      return "Claude Code isn't installed: install it (https://code.claude.com), then run `claude` and sign in";
    case "signed-out":
      return "Claude Code isn't signed in: run `claude` and sign in";
    case "failed":
      return status.message;
    case "signed-in":
      return compareVersions(status.version, MIN_CLAUDE_CODE_VERSION) < 0
        ? `Claude Code ${status.version} is older than ${MIN_CLAUDE_CODE_VERSION}: run \`claude update\``
        : null;
  }
};

/**
 * Claude Code first when it's installed and signed in, else the API when the SDK finds
 * credentials; --ai-via forces one. `claudeCode` is null when it wasn't asked.
 */
export const selectTransport = (
  via: AiVia,
  claudeCode: ClaudeCodeStatus | null,
  apiConfigured: boolean,
): Result<ModelTransport, string> => {
  const problem = claudeCode === null ? null : claudeCodeProblem(claudeCode);
  if (via !== "api" && claudeCode?.state === "signed-in" && problem === null) {
    const { version, plan, billing } = claudeCode;
    return ok({ kind: "claude-code", version, plan, billing });
  }
  if (via === "claude-code") return err(`--ai-via claude-code needs Claude Code. ${problem}.`);
  if (apiConfigured) return ok({ kind: "api" });
  if (via === "api") return err(`--ai-via api: ${NO_ANTHROPIC_CREDENTIALS}`);
  return err(
    `--ai needs Claude Code or the Anthropic API. ${problem}; or set ANTHROPIC_API_KEY or run \`ant auth login\` to use the API.`,
  );
};
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

/** For when the passes are off: fails every pass with a fix hint the UI can show. */
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
    readonly transport?: ModelTransport | null;
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
    transport: options.transport ?? null,
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
 * asks for the model and neither Claude Code nor the API can run it.
 */
export const compose = async (
  config: Config,
  options: ComposeOptions,
): Promise<Result<Composition, string>> => {
  const { logger } = options;
  const clock = systemClock;
  const client = new Anthropic();
  // Aborted on close, which kills the passes still running.
  const running = new AbortController();
  const runClaude: RunClaude = createRunClaude({ signal: running.signal });
  let transport: ModelTransport | null = null;
  if (options.ai !== null) {
    const claudeCode = options.ai === "api" ? null : await claudeCodeStatus(runClaude);
    const needsApi =
      options.ai === "api" || claudeCode === null || claudeCodeProblem(claudeCode) !== null;
    const selected = selectTransport(
      options.ai,
      claudeCode,
      needsApi && (await anthropicConfigured(client, logger)),
    );
    if (!selected.ok) return err(selected.error);
    transport = selected.value;
  }
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
    const api = createClaudeAnalysisModel({ client, logger });
    const model =
      transport === null
        ? unconfiguredModel(api.version)
        : transport.kind === "api"
          ? api
          : createClaudeCodeAnalysisModel({ run: runClaude, billing: transport.billing, logger });
    return ok(
      await assemble(
        {
          hosts: createHosts(config, { version: options.version, clock, logger }),
          threads: createReviewThreads(config, { version: options.version, clock, logger }),
          tickets: createTicketSource(config, logger),
          model,
          modelEnabled: transport !== null,
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
          transport,
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
