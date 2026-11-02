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
  anthropic: { configured: true, retrieveModel: async () => ok(undefined) },
  openStore: () => ok(undefined),
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
      "✓ Anthropic: credentials work, claude-haiku-5-5 is available",
      "✓ Home: /home/lee/.megareviewer is writable and the database opens",
    ]);
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
    expect(missing[4]).toBe(
      "– Anthropic: not configured: reviews run without the model\n    Set ANTHROPIC_API_KEY or run `ant auth login` to use --ai.",
    );
    const rejected = await lines({
      anthropic: { configured: true, retrieveModel: async () => err("401 invalid x-api-key") },
    });
    expect(rejected[4]).toMatch(/^✗ Anthropic: 401 invalid x-api-key\n/);
  });

  it("fails when the home directory or database doesn't open", async () => {
    const output = await lines({ openStore: () => err("EACCES: permission denied") });
    expect(output.at(-1)).toBe(
      "✗ Home: EACCES: permission denied\n    Set MEGAREVIEWER_HOME to a writable directory.",
    );
  });
});
