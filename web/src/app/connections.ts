import type { HostStatus, StatusResponse } from "../../../contracts/index.ts";
import type { HostKind, ModelOption, ModelProvider } from "../../../src/domain/review/index.ts";
import { type ApiError, errorMessage } from "../api/index.ts";
import { relativeTime } from "../pages/picker/relative-time.ts";

export type ConnectionKind = HostKind | "claude" | "codex" | "opencode" | "jira";

/** optional: not connected, and megareviewer works without it. Failing and not connected are issues. */
export type ConnectionState = "working" | "failing" | "not-connected" | "optional" | "checking";

export interface Connection {
  readonly kind: ConnectionKind;
  readonly name: string;
  readonly state: ConnectionState;
  /** What happened, or who is signed in; empty while the first read runs. */
  readonly detail: string;
  /** How to fix or connect it, when it isn't working. */
  readonly fix: string | null;
}

export type ButtonTone = "checking" | "ok" | "warning" | "danger";

export interface Connections {
  /** Failing first, then not connected, then GitHub, Bitbucket, Claude, Codex, opencode, Jira. */
  readonly rows: readonly Connection[];
  readonly button: { readonly label: string; readonly tone: ButtonTone; readonly name: string };
  readonly summary: string;
  /** The status request failed: the server isn't answering. */
  readonly disconnected: string | null;
}

/** How many PRs each host listed, and when, for its row. */
export interface Listed {
  readonly counts: Readonly<Partial<Record<HostKind, number>>>;
  readonly atMs: number;
}

export interface ConnectionsInput {
  readonly status: StatusResponse | null;
  readonly error: ApiError | null;
  /** The status is being read again. */
  readonly checking: boolean;
  readonly checkedAtMs: number | null;
  readonly listed: Listed | null;
  readonly nowMs: number;
}

const HOST_NAMES: Readonly<Record<HostKind, string>> = { github: "GitHub", bitbucket: "Bitbucket" };

const RESTART = "then restart megareviewer.";

const HOST_FIX: Readonly<Record<HostKind, { readonly connect: string; readonly adds: string }>> = {
  github: {
    connect: `Set GITHUB_TOKEN or run \`gh auth login\`, ${RESTART}`,
    adds: "Lists and opens GitHub pull requests.",
  },
  bitbucket: {
    connect: `Set BITBUCKET_EMAIL and BITBUCKET_API_TOKEN, and BITBUCKET_WORKSPACE to list its pull requests, ${RESTART}`,
    adds: "Lists and opens Bitbucket pull requests.",
  },
};

const pullRequests = (count: number) => (count === 1 ? "1 pull request" : `${count} pull requests`);

const host = (
  kind: HostKind,
  status: HostStatus,
  other: HostStatus,
  listed: Listed | null,
  nowMs: number,
): Connection => {
  const name = HOST_NAMES[kind];
  const { connect, adds } = HOST_FIX[kind];
  if (!status.configured) {
    return other.configured
      ? { kind, name, state: "optional", detail: adds, fix: connect }
      : { kind, name, state: "not-connected", detail: `${name} isn't configured.`, fix: connect };
  }
  if (status.user === null) {
    return {
      kind,
      name,
      state: "failing",
      detail: status.error ?? `Couldn't read the signed-in ${name} user.`,
      fix: `Check the token, ${RESTART} A network failure needs only Check again.`,
    };
  }
  const count = listed?.counts[kind];
  const detail =
    count === undefined || listed === null
      ? status.user.name
      : `${status.user.name} · ${pullRequests(count)} listed ${relativeTime(new Date(listed.atMs).toISOString(), nowMs)}`;
  return { kind, name, state: "working", detail, fix: null };
};

type ModelKind = Extract<ConnectionKind, "claude" | "codex" | "opencode">;

const MODEL_TOOLS: Readonly<
  Record<
    ModelKind,
    {
      readonly name: string;
      readonly providers: readonly ModelProvider[];
      readonly adds: string;
      readonly connect: string;
    }
  >
> = {
  claude: {
    name: "Claude",
    providers: ["claude-code", "anthropic-api"],
    adds: "Adds intent, findings, risks and decisions with Request AI review.",
    connect: "Run `claude` and sign in, or set ANTHROPIC_API_KEY.",
  },
  codex: {
    name: "Codex",
    providers: ["codex"],
    adds: "Adds OpenAI's GPT models to Request AI review, on your ChatGPT plan.",
    connect: "Install the Codex CLI and run `codex login`.",
  },
  opencode: {
    name: "opencode",
    providers: ["opencode"],
    adds: "Adds the models of the providers you connected in opencode to Request AI review.",
    connect:
      "Install opencode (https://opencode.ai) and connect a provider with `opencode auth login`.",
  },
};

/** "A", "A and B", "A, B and C" */
const listOf = (items: readonly string[]): string =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;

/** What a working tool offers: the model a run would use on Claude, the models on the others. */
const offered = (kind: ModelKind, available: readonly ModelOption[], defaultId: string | null) => {
  if (kind === "claude") {
    const chosen = available.find((option) => option.id === defaultId) ?? available[0];
    return chosen === undefined ? "" : `${chosen.modelName} through ${chosen.via}`;
  }
  if (kind === "codex") {
    return `${listOf(available.map((option) => option.modelName))} through ${available[0]?.via ?? "Codex"}`;
  }
  const behind = [...new Set(available.map((option) => option.via.replace(/^opencode, on /, "")))];
  const models = available.length === 1 ? "1 model" : `${available.length} models`;
  return `${models} through ${listOf(behind)}`;
};

/**
 * One tool that runs Request AI review: working when any of its options can run, else optional,
 * since megareviewer works without the model, with each of its providers' reasons as the fix.
 */
const modelTool = (
  kind: ModelKind,
  { options, defaultId }: StatusResponse["model"],
): Connection => {
  const { name, providers, adds, connect } = MODEL_TOOLS[kind];
  const own = options.filter((option) => providers.includes(option.provider));
  const available = own.filter((option) => option.available);
  if (available.length > 0) {
    return { kind, name, state: "working", detail: offered(kind, available, defaultId), fix: null };
  }
  const reasons = [...new Set(own.flatMap((option) => option.reason ?? []))];
  return {
    kind,
    name,
    state: "optional",
    detail: adds,
    fix: reasons.length > 0 ? reasons.join("; or ") : `${connect.slice(0, -1)}, ${RESTART}`,
  };
};

const jira = (configured: boolean): Connection =>
  configured
    ? { kind: "jira", name: "Jira", state: "working", detail: "Links tickets", fix: null }
    : {
        kind: "jira",
        name: "Jira",
        state: "optional",
        detail: "Reads the tickets a pull request names.",
        fix: `Set JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN, ${RESTART}`,
      };

const RANK: Readonly<Record<ConnectionState, number>> = {
  failing: 0,
  "not-connected": 1,
  working: 2,
  optional: 2,
  checking: 2,
};

const plural = (count: number, word: string) => (count === 1 ? `1 ${word}` : `${count} ${word}s`);

const PENDING_NAMES: readonly [ConnectionKind, string][] = [
  ["github", "GitHub"],
  ["bitbucket", "Bitbucket"],
  ["claude", "Claude"],
  ["codex", "Codex"],
  ["opencode", "opencode"],
  ["jira", "Jira"],
];

/** The Connections button and its popover, from the status. */
export const connectionsOf = (input: ConnectionsInput): Connections => {
  const { status, error, checking, checkedAtMs, listed, nowMs } = input;
  if (error !== null && !checking) {
    return {
      rows: [],
      button: {
        label: "Disconnected",
        tone: "danger",
        name: "Connections: megareviewer's server isn't answering. Open for details.",
      },
      summary: "megareviewer's server isn't answering",
      disconnected: errorMessage(error),
    };
  }
  if (status === null) {
    return {
      rows: PENDING_NAMES.map(([kind, name]) => ({
        kind,
        name,
        state: "checking",
        detail: "",
        fix: null,
      })),
      button: {
        label: "Checking…",
        tone: "checking",
        name: "Connections: checking. Open for details.",
      },
      summary: `Checking ${PENDING_NAMES.length} connections…`,
      disconnected: null,
    };
  }
  const { github, bitbucket } = status.hosts;
  const rows = [
    host("github", github, bitbucket, listed, nowMs),
    host("bitbucket", bitbucket, github, listed, nowMs),
    modelTool("claude", status.model),
    modelTool("codex", status.model),
    modelTool("opencode", status.model),
    jira(status.jira.configured),
  ].sort((a, b) => RANK[a.state] - RANK[b.state]);

  const count = (state: ConnectionState) => rows.filter((row) => row.state === state).length;
  const failing = count("failing");
  const notConnected = count("not-connected");
  const working = count("working");
  const optional = count("optional");
  const issues = failing + notConnected;
  const parts = [
    ...(failing > 0 ? [`${failing} failing`] : []),
    ...(notConnected > 0 ? [`${notConnected} not connected`] : []),
    ...(working > 0 ? [`${working} working`] : []),
    ...(optional > 0 && issues === 0 ? [`${optional} optional`] : []),
  ];
  const checked =
    checkedAtMs === null
      ? ""
      : ` · checked ${relativeTime(new Date(checkedAtMs).toISOString(), nowMs)}`;
  const summary =
    issues > 0
      ? parts.join(" · ")
      : working === rows.length
        ? `All ${working} working${checked}`
        : `${parts.join(" · ")}${checked}`;
  const name = `Connections: ${parts.join(" · ")}. ${issues > 0 ? "Open to fix." : "Open for details."}`;

  if (checking) {
    return {
      rows: rows.map((row) => ({ ...row, state: "checking" })),
      button: {
        label: "Checking…",
        tone: "checking",
        name: "Connections: checking. Open for details.",
      },
      summary: `Checking ${rows.length} connections…`,
      disconnected: null,
    };
  }
  const button: { readonly label: string; readonly tone: ButtonTone } =
    issues > 0
      ? { label: plural(issues, "issue"), tone: failing > 0 ? "danger" : "warning" }
      : working === rows.length
        ? { label: "All connected", tone: "ok" }
        : { label: `${working} of ${rows.length} connected`, tone: "ok" };
  return {
    rows,
    button: { ...button, name },
    summary,
    disconnected: null,
  };
};
