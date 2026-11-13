import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import {
  type ClaudeCodeStatus,
  claudeCodeStatus,
  createRunClaude,
  MIN_CLAUDE_CODE_VERSION,
  planName,
} from "../adapters/claude/index.ts";
import { type CheckoutInfo, inspectCheckout } from "../adapters/git/index.ts";
import { openSqliteAnalysisStore } from "../adapters/sqlite/index.ts";
import type { GitHost, Logger, TicketSource } from "../application/ports/index.ts";
import type { HostKind, RepoRef } from "../domain/review/index.ts";
import { err, ok, type Result } from "../domain/shared/index.ts";
import { createHosts, createTicketSource, systemClock } from "./compose.ts";
import type { BitbucketCredential, Config, GitHubTokenSource } from "./config.ts";
import { anthropicConfigured, claudeCodeProblem } from "./model-access.ts";
import { NODE_FIX, nodeSupported } from "./node-version.ts";

export interface Check {
  /** "skip": an optional service that isn't configured. */
  readonly status: "pass" | "fail" | "skip";
  readonly title: string;
  readonly detail: string;
  readonly fix: string | null;
}

export interface DoctorDeps {
  readonly nodeVersion: string;
  readonly config: Config;
  readonly problems: readonly string[];
  readonly hosts: Partial<Record<HostKind, GitHost>>;
  readonly tickets: TicketSource;
  readonly claudeCode: ClaudeCodeStatus;
  readonly anthropic: {
    readonly configured: boolean;
    /** Fetches the model the passes use: free, and proves the credentials work. */
    retrieveModel(): Promise<Result<void, string>>;
  };
  /** Creates the home directory if needed, then opens and closes the database. */
  openStore(): Result<void, string>;
  /** Where unchanged callers are read from, and what's there; null when it isn't a checkout. */
  readonly checkout: { readonly dir: string; readonly info: CheckoutInfo | null };
}

/** The model the Claude adapter uses. */
const MODEL = "claude-haiku-5-5";
/** A key no Jira site has, so a working login answers "missing". */
const PROBE_TICKET = "MEGAREVIEWER-0";

const check = (
  status: Check["status"],
  title: string,
  detail: string,
  fix: string | null = null,
): Check => ({ status, title, detail, fix });

const GITHUB_FIX: Readonly<Record<GitHubTokenSource, string>> = {
  GITHUB_TOKEN: "Check GITHUB_TOKEN: it needs read access to the repos and pull requests.",
  GH_TOKEN: "Check GH_TOKEN: it needs read access to the repos and pull requests.",
  "gh auth token": "Run `gh auth login` again, or set GITHUB_TOKEN.",
};

const checkGitHub = async (deps: DoctorDeps): Promise<Check> => {
  const { github } = deps.config;
  const host = deps.hosts.github;
  if (github === null || host === undefined) {
    return check("skip", "GitHub", "not configured", "Set GITHUB_TOKEN or run `gh auth login`.");
  }
  const user = await host.currentUser();
  return user.ok
    ? check("pass", "GitHub", `signed in as ${user.value.id} (token from ${github.source})`)
    : check("fail", "GitHub", user.error.message, GITHUB_FIX[github.source]);
};

const BITBUCKET_FIX: Readonly<Record<BitbucketCredential, string>> = {
  "api token": "Check BITBUCKET_EMAIL and BITBUCKET_API_TOKEN, and the token's scopes.",
  // Atlassian removed app passwords in July 2026, so a rejected one is most likely just that.
  "app password":
    "Check BITBUCKET_USERNAME and BITBUCKET_APP_PASSWORD. If Bitbucket no longer accepts app passwords, set BITBUCKET_EMAIL and BITBUCKET_API_TOKEN (a scoped Atlassian API token) instead.",
};

const checkBitbucket = async (deps: DoctorDeps): Promise<Check> => {
  const { bitbucket } = deps.config;
  const host = deps.hosts.bitbucket;
  if (bitbucket === null || host === undefined) {
    return check(
      "skip",
      "Bitbucket",
      "not configured",
      "Set BITBUCKET_EMAIL and BITBUCKET_API_TOKEN (a scoped Atlassian API token).",
    );
  }
  const user = await host.currentUser();
  if (!user.ok) {
    return check("fail", "Bitbucket", user.error.message, BITBUCKET_FIX[bitbucket.credential]);
  }
  const signedIn = `signed in as ${user.value.name}`;
  return bitbucket.workspace === null
    ? check(
        "pass",
        "Bitbucket",
        `${signedIn}; the picker lists no Bitbucket PRs`,
        "Set BITBUCKET_WORKSPACE to list its PRs.",
      )
    : check("pass", "Bitbucket", `${signedIn}, listing PRs in ${bitbucket.workspace}`);
};

const checkJira = async (deps: DoctorDeps): Promise<Check> => {
  const { jira } = deps.config;
  if (jira === null) {
    return check(
      "skip",
      "Jira",
      "not configured: ticket keys are shown but not fetched",
      "Set JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN to fetch them.",
    );
  }
  const lookup = await deps.tickets.getTickets([PROBE_TICKET]);
  return lookup.ok
    ? check("pass", "Jira", `signed in at ${jira.baseUrl}`)
    : check(
        "fail",
        "Jira",
        lookup.error.message,
        "Check JIRA_EMAIL and JIRA_API_TOKEN (an Atlassian API token without scopes).",
      );
};

/** What Request AI review runs on first. Without it, reviews run without the model, or on the API. */
const checkClaudeCode = ({ claudeCode }: DoctorDeps): Check => {
  const title = "Claude Code";
  switch (claudeCode.state) {
    case "not-installed":
      return check(
        "skip",
        title,
        "not installed: Request AI review runs on the Anthropic API instead, if it's configured",
        "Install Claude Code (https://code.claude.com) and sign in with `claude` to analyze on your Claude plan.",
      );
    case "signed-out":
      return check(
        "skip",
        title,
        `${claudeCode.version}, not signed in: Request AI review runs on the Anthropic API instead, if it's configured`,
        "Run `claude` and sign in to analyze on your Claude plan.",
      );
    case "failed":
      return check("fail", title, claudeCode.message, "Run `claude doctor`.");
    case "signed-in": {
      const problem = claudeCodeProblem(claudeCode);
      if (problem !== null) {
        return check(
          "fail",
          title,
          `${claudeCode.version}, older than ${MIN_CLAUDE_CODE_VERSION}, the oldest megareviewer was checked with`,
          "Run `claude update`.",
        );
      }
      const pays =
        claudeCode.billing === "plan"
          ? `on ${planName(claudeCode.plan)}`
          : "billed to your Anthropic Console account";
      return check(
        "pass",
        title,
        `${claudeCode.version}, signed in: Request AI review runs here, ${pays}`,
      );
    }
  }
};

const checkAnthropic = async (deps: DoctorDeps): Promise<Check> => {
  const title = "Anthropic API";
  if (!deps.anthropic.configured) {
    return check(
      "skip",
      title,
      "not configured: the fallback for Request AI review when Claude Code can't run it",
      "Set ANTHROPIC_API_KEY or run `ant auth login` to use it.",
    );
  }
  const retrieved = await deps.anthropic.retrieveModel();
  return retrieved.ok
    ? check(
        "pass",
        title,
        `credentials work, ${MODEL} is available: the fallback for Request AI review when Claude Code can't run it`,
      )
    : check(
        "fail",
        title,
        retrieved.error,
        "Check ANTHROPIC_API_KEY, or run `ant auth login` again.",
      );
};

const HOST_DOMAINS: Readonly<Record<HostKind, string>> = {
  github: "github.com",
  bitbucket: "bitbucket.org",
};

export const repoName = ({ host, owner, repo }: RepoRef): string =>
  `${HOST_DOMAINS[host]}/${owner}/${repo}`;

/** No PR to check the commit of: says where callers come from, and what a missing commit needs. */
const checkCheckout = ({ checkout: { dir, info } }: DoctorDeps): Check => {
  if (info === null) {
    return check(
      "skip",
      "Checkout",
      `${dir} isn't in a git checkout: callers outside a PR aren't shown`,
      "Run megareviewer in a checkout of the PR's repository, or pass --checkout <dir>.",
    );
  }
  const repos =
    info.repos.length === 0
      ? "with no GitHub or Bitbucket remote; read for a PR whose head commit it has"
      : `a checkout of ${info.repos.map(repoName).join(", ")}`;
  return check(
    "pass",
    "Checkout",
    `${info.root}, ${repos}`,
    "Callers outside a PR need its head commit: if a review says it's missing, run `git fetch` there.",
  );
};

/** One check per line of `doctor`, in a fixed order. Network checks run in parallel. */
export const runDoctor = async (deps: DoctorDeps): Promise<Check[]> => {
  const node = nodeSupported(deps.nodeVersion)
    ? check("pass", "Node", deps.nodeVersion)
    : check("fail", "Node", deps.nodeVersion, NODE_FIX);
  const problems = deps.problems.map((problem) => check("fail", "Configuration", problem));
  const services = await Promise.all([
    checkGitHub(deps),
    checkBitbucket(deps),
    checkJira(deps),
    checkClaudeCode(deps),
    checkAnthropic(deps),
  ]);
  const opened = deps.openStore();
  const store = opened.ok
    ? check("pass", "Home", `${deps.config.home} is writable and the database opens`)
    : check("fail", "Home", opened.error, "Set MEGAREVIEWER_HOME to a writable directory.");
  return [node, ...problems, ...services, checkCheckout(deps), store];
};

const MARK: Readonly<Record<Check["status"], string>> = { pass: "✓", fail: "✗", skip: "–" };

export const formatCheck = ({ status, title, detail, fix }: Check): string =>
  `${MARK[status]} ${title}: ${detail}${fix === null ? "" : `\n    ${fix}`}`;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const createDoctorDeps = async (options: {
  readonly config: Config;
  /** The directory unchanged callers are read from. */
  readonly checkoutDir: string;
  readonly problems: readonly string[];
  readonly version: string;
  readonly logger: Logger;
}): Promise<DoctorDeps> => {
  const { config, logger } = options;
  const client = new Anthropic({ maxRetries: 0 });
  return {
    nodeVersion: process.versions.node,
    checkout: { dir: options.checkoutDir, info: await inspectCheckout(options.checkoutDir) },
    config,
    problems: options.problems,
    hosts: createHosts(config, { version: options.version, clock: systemClock, logger }),
    tickets: createTicketSource(config, logger),
    claudeCode: await claudeCodeStatus(createRunClaude()),
    anthropic: {
      configured: await anthropicConfigured(client, logger),
      async retrieveModel() {
        try {
          await client.models.retrieve(MODEL);
          return ok(undefined);
        } catch (error) {
          return err(messageOf(error));
        }
      },
    },
    openStore() {
      try {
        mkdirSync(config.home, { recursive: true, mode: 0o700 });
        const store = openSqliteAnalysisStore({
          path: join(config.home, "db.sqlite"),
          clock: systemClock,
          logger,
        });
        store.close();
        return ok(undefined);
      } catch (error) {
        return err(messageOf(error));
      }
    },
  };
};
