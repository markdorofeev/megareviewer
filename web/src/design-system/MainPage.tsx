import { InboxIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { PullRequestListResponse, StatusResponse } from "../../../contracts/index.ts";
import type { PullRequestSummary, ReviewActivity } from "../../../src/domain/review/index.ts";
import { ConnectionsPopover } from "../app/ConnectionsButton.tsx";
import { type ConnectionsInput, connectionsOf } from "../app/connections.ts";
import { PullRequestList } from "../pages/picker/PullRequestList.tsx";
import { PullRequestLists } from "../pages/picker/PullRequestLists.tsx";
import { ReviewActivityCard } from "../pages/picker/ReviewActivity.tsx";
import { EMPTY_LINK, NOT_A_LINK, UrlForm } from "../pages/picker/UrlForm.tsx";

// Made-up data for the preview: an example organization, its pull requests and people.

const NOW = Date.parse("2026-10-21T15:00:00Z");
const now = () => NOW;
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const pr = (
  host: "github" | "bitbucket",
  repo: string,
  number: number,
  title: string,
  author: string,
  minutes: number,
  role: PullRequestSummary["role"],
): PullRequestSummary => ({
  ref: { repo: { host, owner: "acme", repo }, number },
  url:
    host === "github"
      ? `https://github.com/acme/${repo}/pull/${number}`
      : `https://bitbucket.org/acme/${repo}/pull-requests/${number}`,
  title,
  author: { id: author, name: author },
  updatedAt: minutesAgo(minutes),
  role,
});

const ITEMS: readonly PullRequestSummary[] = [
  pr("github", "billing", 1291, "Prorate seat changes mid-cycle", "jkim", 8, "reviewer"),
  pr("github", "web", 3307, "Move checkout form to server actions", "lsato", 25, "reviewer"),
  pr("bitbucket", "api", 902, "Paginate the audit log endpoint", "rnovak", 70, "reviewer"),
  pr("github", "scheduler", 482, "Add exponential backoff to job retries", "you", 1500, "author"),
  pr("bitbucket", "infra", 77, "Pin the Postgres image to 17.4", "you", 2900, "author"),
];

const user = (name: string) => ({ configured: true, user: { id: name, name }, error: null });
const OFF = { configured: false, user: null, error: null };
const FAILING = { configured: true, user: null, error: "Bitbucket rejected the API token (401)." };

const modelOption = (
  provider: StatusResponse["model"]["options"][number]["provider"],
  providerName: string,
  model: string,
  modelName: string,
  via: string,
): StatusResponse["model"]["options"][number] => ({
  id: `${provider}/${model}`,
  provider,
  providerName,
  model,
  modelName,
  family: modelName.split(/[\s-]/)[0] ?? modelName,
  via,
  measured: provider !== "opencode",
  available: true,
  reason: null,
});

const MODEL: StatusResponse["model"] = {
  options: [
    modelOption(
      "claude-code",
      "Claude Code",
      "claude-sonnet-5-5",
      "Sonnet 5.5",
      "Claude Code, on your Pro plan",
    ),
    modelOption("codex", "Codex", "gpt-6-sol", "GPT-6 Sol", "Codex, on your ChatGPT plan"),
    modelOption(
      "opencode",
      "opencode on Ollama",
      "ollama/qwen3-coder:30b",
      "Qwen3 Coder 30B",
      "opencode, on Ollama",
    ),
  ],
  defaultId: "claude-code/claude-sonnet-5-5",
};
const NOT_RUNNING: Readonly<Record<string, string>> = {
  "claude-code": "Claude Code isn't signed in: run `claude` and sign in",
  codex: "Codex isn't installed: install the Codex CLI, then run `codex login`",
  opencode: "opencode has no provider connected: run `opencode auth login`",
};
const LOCKED: StatusResponse["model"] = {
  ...MODEL,
  options: MODEL.options.map((option) => ({
    ...option,
    available: false,
    reason: NOT_RUNNING[option.provider] ?? null,
  })),
};

const STATUS: StatusResponse = {
  version: "0.2.9",
  hosts: { github: user("Mina Ito"), bitbucket: user("mina-ito") },
  jira: { configured: true },
  model: MODEL,
};
const withHosts = (
  hosts: Partial<StatusResponse["hosts"]>,
  change: Partial<StatusResponse> = {},
) => ({
  ...STATUS,
  ...change,
  hosts: { ...STATUS.hosts, ...hosts },
});

const LIST: PullRequestListResponse = { items: ITEMS, errors: [] };
const githubOnly = (message: string): PullRequestListResponse => ({
  items: ITEMS.filter((item) => item.ref.repo.host === "github"),
  errors: [{ host: "bitbucket", message }],
});

const connection = (input: Partial<ConnectionsInput>) =>
  connectionsOf({
    status: STATUS,
    error: null,
    checking: false,
    checkedAtMs: NOW - 2 * 60_000,
    listed: { counts: { github: 3, bitbucket: 2 }, atMs: NOW - 2 * 60_000 },
    nowMs: NOW,
    ...input,
  });

const BUTTONS: readonly { readonly title: string; readonly input: Partial<ConnectionsInput> }[] = [
  { title: "Checking", input: { status: null, checking: true } },
  { title: "All connected", input: {} },
  {
    title: "Some connected",
    input: {
      status: withHosts({ bitbucket: OFF }, { model: LOCKED, jira: { configured: false } }),
    },
  },
  { title: "Not connected", input: { status: withHosts({ github: OFF, bitbucket: OFF }) } },
  { title: "Failing", input: { status: withHosts({ bitbucket: FAILING }) } },
  {
    title: "Disconnected",
    input: {
      status: null,
      error: { code: "unreachable", message: "megareviewer isn't answering on 127.0.0.1:4823." },
    },
  },
];

/** A reviewer who reviewed most weekdays, seeded so the squares never change. */
const activeActivity = (): ReviewActivity => {
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const reviews: ReviewActivity["reviews"][number][] = [];
  const comments: string[] = [];
  let number = 100;
  for (let daysAgo = 26 * 7; daysAgo >= 1; daysAgo -= 1) {
    const at = new Date(NOW - daysAgo * 86_400_000).toISOString();
    const weekend = [0, 6].includes(new Date(at).getUTCDay());
    const count = daysAgo === 3 ? 7 : weekend ? 0 : Math.floor(random() * 5);
    for (let index = 0; index < count; index += 1) {
      number += 1;
      reviews.push({
        at,
        pullRequest: { repo: { host: "github", owner: "acme", repo: "web" }, number },
      });
      for (let comment = Math.floor(random() * 4); comment > 0; comment -= 1) comments.push(at);
    }
  }
  return { reviews, comments };
};

const Example = ({ title, children }: { readonly title: string; readonly children: ReactNode }) => (
  <div className="flex min-w-0 flex-col gap-2">
    <h4 className="text-caption font-medium text-muted-foreground">{title}</h4>
    {children}
  </div>
);

const Group = ({ title, children }: { readonly title: string; readonly children: ReactNode }) => (
  <section className="flex flex-col gap-3">
    <h3 className="text-heading font-semibold">{title}</h3>
    {children}
  </section>
);

const noop = () => {};
const NO_EMPTY = { icon: InboxIcon, title: "", text: "" };

const lists = (props: Partial<Parameters<typeof PullRequestLists>[0]>) => (
  <PullRequestLists
    status={STATUS}
    list={LIST}
    error={null}
    rowFailure={null}
    startingUrl={null}
    nowMs={NOW}
    onOpen={noop}
    onRetry={noop}
    onOpenConnections={noop}
    onFix={noop}
    {...props}
  />
);

/** The main page's parts in each of their states. */
export const MainPage = () => (
  <div className="flex flex-col gap-8 rounded-xl bg-surface-subtle p-4">
    <Group title="Connections">
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        {BUTTONS.map(({ title, input }) => (
          <Example key={title} title={title}>
            <ConnectionsPopover
              connections={connection(input)}
              version="0.2.9"
              checking={input.checking === true}
              onCheckAgain={noop}
            />
          </Example>
        ))}
      </div>
    </Group>

    <Group title="Link field">
      <div className="grid gap-4 lg:grid-cols-2">
        <Example title="Empty">
          <UrlForm start={null} onSubmit={noop} onEdit={noop} />
        </Example>
        <Example title="Submitted empty">
          <UrlForm
            start={null}
            onSubmit={noop}
            onEdit={noop}
            initial={{ url: "", invalid: EMPTY_LINK }}
          />
        </Example>
        <Example title="Not a pull request link">
          <UrlForm
            start={null}
            onSubmit={noop}
            onEdit={noop}
            initial={{ url: "https://gitlab.com/acme/api/-/merge_requests/9", invalid: NOT_A_LINK }}
          />
        </Example>
        <Example title="Starting">
          <UrlForm
            start={{
              state: "starting",
              message: "Fetching acme/api #902 from GitHub…",
              onCancel: noop,
            }}
            onSubmit={noop}
            onEdit={noop}
            initial={{ url: "https://github.com/acme/api/pull/902", invalid: null }}
          />
        </Example>
        <Example title="Failed">
          <UrlForm
            start={{
              state: "failed",
              message: "Couldn't open acme/api #902: GitHub has no pull request #902 in acme/api.",
              onRetry: noop,
            }}
            onSubmit={noop}
            onEdit={noop}
            initial={{ url: "https://github.com/acme/api/pull/902", invalid: null }}
          />
        </Example>
      </div>
    </Group>

    <Group title="Rows">
      <div className="grid gap-4 lg:grid-cols-2">
        <Example title="A row, and one starting">
          <PullRequestList
            title="To review"
            word="Waiting for your review"
            items={ITEMS.slice(0, 2)}
            count={2}
            loading="Loading"
            skeletonRows={2}
            empty={NO_EMPTY}
            nowMs={NOW}
            startingUrl={ITEMS[1]?.url ?? null}
            onOpen={noop}
          />
        </Example>
        <Example title="Narrower than 480 px">
          <div className="max-w-[420px]">
            <PullRequestList
              title="Your pull requests"
              word="Open"
              items={ITEMS.slice(3)}
              count={2}
              loading="Loading"
              skeletonRows={2}
              empty={NO_EMPTY}
              nowMs={NOW}
              startingUrl={null}
              onOpen={noop}
            />
          </div>
        </Example>
      </div>
    </Group>

    <Group title="Lists">
      <Example title="Loading, first read">{lists({ list: null })}</Example>
      <Example title="Rows">{lists({})}</Example>
      <Example title="Empty">{lists({ list: { items: [], errors: [] } })}</Example>
      <Example title="No git host configured">
        {lists({
          status: withHosts({ github: OFF, bitbucket: OFF }),
          list: { items: [], errors: [] },
        })}
      </Example>
      <Example title="One host's list failed">
        {lists({ list: githubOnly("Bitbucket returned 503 Service Unavailable.") })}
      </Example>
      <Example title="One host failing in Connections">
        {lists({ status: withHosts({ bitbucket: FAILING }), list: githubOnly("401") })}
      </Example>
      <Example title="Every host failed">
        {lists({
          list: {
            items: [],
            errors: [
              { host: "github", message: "GitHub returned 502 Bad Gateway." },
              { host: "bitbucket", message: "Bitbucket returned 503 Service Unavailable." },
            ],
          },
        })}
      </Example>
      <Example title="The request failed">
        {lists({
          list: null,
          error: { code: "unreachable", message: "megareviewer isn't answering." },
        })}
      </Example>
      <Example title="A read again failed, and a start that failed">
        {lists({
          error: { code: "unreachable", message: "megareviewer isn't answering." },
          rowFailure: {
            role: "reviewer",
            message: "Couldn't open acme/web #3307: GitHub took too long to answer.",
            onRetry: noop,
          },
        })}
      </Example>
    </Group>

    <Group title="Review activity">
      <Example title="An active reviewer">
        <ReviewActivityCard activity={activeActivity()} error={null} onRetry={noop} now={now} />
      </Example>
      <Example title="A new reviewer">
        <ReviewActivityCard
          activity={{ reviews: [], comments: [] }}
          error={null}
          onRetry={noop}
          now={now}
        />
      </Example>
      <Example title="Loading">
        <ReviewActivityCard activity={null} error={null} onRetry={noop} now={now} />
      </Example>
      <Example title="Failed">
        <ReviewActivityCard
          activity={null}
          error={{ code: "unreachable", message: "megareviewer isn't answering." }}
          onRetry={noop}
          now={now}
        />
      </Example>
    </Group>
  </div>
);
