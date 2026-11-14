import { describe, expect, it } from "vitest";
import { allFixtures, FakeGitHost, FakeTicketSource } from "../application/testing/index.ts";
import { err, ok } from "../domain/shared/index.ts";
import type { BitbucketConfig, Config } from "./config.ts";
import { type DoctorDeps, formatCheck, runDoctor } from "./doctor.ts";
import { NODE_FIX } from "./node-version.ts";

const BITBUCKET: BitbucketConfig = {
  credential: "api token",
  username: "lee@example.com",
  password: "x",
  workspace: "acme",
};

const CONFIG: Config = {
  github: { token: "ghp_x", source: "gh auth token" },
  bitbucket: BITBUCKET,
  jira: { baseUrl: "https://acme.atlassian.net", email: "lee@example.com", apiToken: "x" },
  home: "/home/lee/.megareviewer",
  logLevel: "info",
};

const deps = (overrides: Partial<DoctorDeps> = {}): DoctorDeps => ({
  nodeVersion: "24.21.0",
  config: CONFIG,
  problems: [],
  hosts: {
    github: new FakeGitHost({ host: "github", fixtures: allFixtures }),
    bitbucket: new FakeGitHost({ host: "bitbucket", fixtures: allFixtures }),
  },
  tickets: new FakeTicketSource(),
  claudeCode: { state: "signed-in", version: "2.1.303", plan: "pro", billing: "plan" },
  codex: {
    state: "signed-in",
    version: "0.162.0",
    billing: "plan",
    models: [
      { slug: "gpt-6-luna", contextWindow: 272_000, efforts: ["low", "medium", "high"] },
      { slug: "gpt-6-sol", contextWindow: 272_000, efforts: ["low", "medium", "high"] },
    ],
  },
  anthropic: { configured: true, retrieveModel: async () => ok(undefined) },
  openStore: () => ok(undefined),
  checkout: {
    dir: "/home/lee/src/shop/web",
    info: {
      root: "/home/lee/src/shop",
      repos: [{ host: "github", owner: "acme", repo: "shop" }],
    },
  },
  ...overrides,
});

const lines = async (overrides: Partial<DoctorDeps> = {}) =>
  (await runDoctor(deps(overrides))).map(formatCheck);

const HOST_ERROR = {
  kind: "unauthorized",
  message: "Bad credentials",
  retryAfterSeconds: null,
} as const;

describe("runDoctor", () => {
  it("passes every check when everything works", async () => {
    expect(await lines()).toEqual([
      "✓ Node: 24.21.0",
      "✓ GitHub: signed in as lee-park (token from gh auth token)",
      "✓ Bitbucket: signed in as Lee Park, listing PRs in acme",
      "✓ Jira: signed in at https://acme.atlassian.net",
      "✓ Claude Code: 2.1.303, signed in, on your Pro plan: Request AI review offers Haiku 5.5, Sonnet 5.5 and Opus 5.5 on it",
      "✓ Anthropic API: credentials work, billed to your account: Request AI review offers Haiku 5.5, Sonnet 5.5 and Opus 5.5 on it",
      "✓ Codex: 0.162.0, signed in, on your ChatGPT plan: Request AI review offers GPT-6 Luna and GPT-6 Sol on it",
      "✓ Checkout: /home/lee/src/shop, a checkout of github.com/acme/shop\n    Callers outside a PR need its head commit: if a review says it's missing, run `git fetch` there.",
      "✓ Home: /home/lee/.megareviewer is writable and the database opens",
    ]);
  });

  it("skips the checkout outside a git checkout", async () => {
    const checks = await runDoctor(deps({ checkout: { dir: "/tmp", info: null } }));
    expect(checks.find((check) => check.title === "Checkout")).toEqual({
      status: "skip",
      title: "Checkout",
      detail: "/tmp isn't in a git checkout: callers outside a PR aren't shown",
      fix: "Run megareviewer in a checkout of the PR's repository, or pass --checkout <dir>.",
    });
  });

  it("names a checkout without a GitHub or Bitbucket remote", async () => {
    const checks = await runDoctor(
      deps({ checkout: { dir: "/src/shop", info: { root: "/src/shop", repos: [] } } }),
    );
    expect(checks.find((check) => check.title === "Checkout")?.detail).toBe(
      "/src/shop, with no GitHub or Bitbucket remote; read for a PR whose head commit it has",
    );
  });

  it("fails an old Node and each configuration problem", async () => {
    const checks = await runDoctor(deps({ nodeVersion: "22.11.0", problems: ["A", "B"] }));
    expect(checks.slice(0, 3).map((check) => [check.status, check.detail])).toEqual([
      ["fail", "22.11.0"],
      ["fail", "A"],
      ["fail", "B"],
    ]);
    expect(checks[0]?.fix).toBe(NODE_FIX);
  });

  it("skips services that aren't configured", async () => {
    const checks = await runDoctor(
      deps({ config: { ...CONFIG, github: null, bitbucket: null, jira: null }, hosts: {} }),
    );
    expect(checks.filter((check) => check.status === "skip").map((check) => check.title)).toEqual([
      "GitHub",
      "Bitbucket",
      "Jira",
    ]);
  });

  it("fails a host whose currentUser fails, with a fix for its token source", async () => {
    const github = new FakeGitHost({ host: "github" });
    github.failNext("currentUser", HOST_ERROR);
    const output = await lines({ hosts: { ...deps().hosts, github } });
    expect(output[1]).toBe(
      "✗ GitHub: Bad credentials\n    Run `gh auth login` again, or set GITHUB_TOKEN.",
    );
  });

  it("fails Bitbucket's login, and hints at the workspace when there is none", async () => {
    const bitbucket = new FakeGitHost({ host: "bitbucket" });
    bitbucket.failNext("currentUser", HOST_ERROR);
    expect((await lines({ hosts: { ...deps().hosts, bitbucket } }))[2]).toBe(
      "✗ Bitbucket: Bad credentials\n" +
        "    Check BITBUCKET_EMAIL and BITBUCKET_API_TOKEN, and the token's scopes.",
    );
    const noWorkspace = await lines({
      config: {
        ...CONFIG,
        bitbucket: { ...BITBUCKET, workspace: null },
      },
    });
    expect(noWorkspace[2]).toBe(
      "✓ Bitbucket: signed in as Lee Park; the picker lists no Bitbucket PRs\n" +
        "    Set BITBUCKET_WORKSPACE to list its PRs.",
    );
  });

  it("suggests an API token when an app password is rejected", async () => {
    const bitbucket = new FakeGitHost({ host: "bitbucket" });
    bitbucket.failNext("currentUser", HOST_ERROR);
    const appPassword = await lines({
      hosts: { ...deps().hosts, bitbucket },
      config: { ...CONFIG, bitbucket: { ...BITBUCKET, credential: "app password" } },
    });
    expect(appPassword[2]).toContain("set BITBUCKET_EMAIL and BITBUCKET_API_TOKEN");
  });

  it("asks Jira for a key that doesn't exist and fails on an error", async () => {
    const tickets = new FakeTicketSource();
    await lines({ tickets });
    expect(tickets.calls).toEqual([["MEGAREVIEWER-0"]]);

    const failing = new FakeTicketSource();
    failing.failNext({ kind: "unauthorized", message: "Jira said 401" });
    expect((await lines({ tickets: failing }))[3]).toMatch(/^✗ Jira: Jira said 401\n/);
  });

  it("skips Anthropic without credentials, and fails when the model can't be fetched", async () => {
    const missing = await lines({
      anthropic: { configured: false, retrieveModel: async () => ok(undefined) },
    });
    expect(missing[5]).toBe(
      "– Anthropic API: not configured: Haiku 5.5, Sonnet 5.5 and Opus 5.5 on it are listed, disabled, in Request AI review's menu\n    Set ANTHROPIC_API_KEY or run `ant auth login` to use it.",
    );
    const rejected = await lines({
      anthropic: { configured: true, retrieveModel: async () => err("401 invalid x-api-key") },
    });
    expect(rejected[5]).toMatch(/^✗ Anthropic API: 401 invalid x-api-key\n/);
  });

  it.each<[DoctorDeps["claudeCode"], string]>([
    [
      { state: "not-installed" },
      "– Claude Code: not installed: Haiku 5.5, Sonnet 5.5 and Opus 5.5 on it are listed, disabled, in Request AI review's menu\n    Install Claude Code (https://code.claude.com) and sign in with `claude` to analyze on your Claude plan.",
    ],
    [
      { state: "signed-out", version: "2.1.303" },
      "– Claude Code: 2.1.303, not signed in: Haiku 5.5, Sonnet 5.5 and Opus 5.5 on it are listed, disabled, in Request AI review's menu\n    Run `claude` and sign in to analyze on your Claude plan.",
    ],
    [
      { state: "signed-in", version: "2.0.9", plan: "max", billing: "plan" },
      "✗ Claude Code: 2.0.9, older than 2.1.303, the oldest megareviewer was checked with\n    Run `claude update`.",
    ],
    [
      { state: "signed-in", version: "2.1.303", plan: null, billing: "api" },
      "✓ Claude Code: 2.1.303, signed in, billed to your Anthropic Console account: Request AI review offers Haiku 5.5, Sonnet 5.5 and Opus 5.5 on it",
    ],
    [
      { state: "failed", message: "`claude auth status` gave no status: no output" },
      "✗ Claude Code: `claude auth status` gave no status: no output\n    Run `claude doctor`.",
    ],
  ])("says what Claude Code can do: %j", async (claudeCode, line) => {
    expect((await lines({ claudeCode }))[4]).toBe(line);
  });

  it.each<[DoctorDeps["codex"], string]>([
    [
      { state: "not-installed" },
      "– Codex: not installed: GPT-6 Luna and GPT-6 Sol on it are listed, disabled, in Request AI review's menu\n    Install the Codex CLI and run `codex login` to analyze on your ChatGPT plan.",
    ],
    [
      { state: "signed-out", version: "0.162.0" },
      "– Codex: 0.162.0, not signed in: GPT-6 Luna and GPT-6 Sol on it are listed, disabled, in Request AI review's menu\n    Run `codex login` to analyze on your ChatGPT plan.",
    ],
    [
      { state: "signed-in", version: "0.150.0", billing: "plan", models: [] },
      "✗ Codex: 0.150.0, older than 0.162.0, the oldest megareviewer was checked with\n    Run `codex update`.",
    ],
    [
      {
        state: "signed-in",
        version: "0.162.0",
        billing: "api",
        models: [{ slug: "gpt-6-sol", contextWindow: null, efforts: [] }],
      },
      "✓ Codex: 0.162.0, signed in, billed to your OpenAI account: Request AI review offers GPT-6 Sol on it",
    ],
    [
      { state: "signed-in", version: "0.162.0", billing: "plan", models: [] },
      "✗ Codex: 0.162.0, signed in, on your ChatGPT plan, but its catalog has none of GPT-6 Luna and GPT-6 Sol\n    Run `codex debug models` to see the models your account has.",
    ],
  ])("says what Codex can do: %j", async (codex, line) => {
    expect((await lines({ codex }))[6]).toBe(line);
  });

  it("fails when the home directory or database doesn't open", async () => {
    const output = await lines({ openStore: () => err("EACCES: permission denied") });
    expect(output.at(-1)).toBe(
      "✗ Home: EACCES: permission denied\n    Set MEGAREVIEWER_HOME to a writable directory.",
    );
  });
});
