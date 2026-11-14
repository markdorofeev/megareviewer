import { describe, expect, it } from "vitest";
import { type Env, loadConfig, NO_GIT_HOST, type RunCommand } from "./config.ts";

const GH_MISSING: RunCommand = async () => null;

const load = (env: Env, run: RunCommand = GH_MISSING) =>
  loadConfig({ env, run, homeDir: "/home/lee" });

const GITHUB = { GITHUB_TOKEN: "ghp_env" };

describe("loadConfig: GitHub", () => {
  it("prefers GITHUB_TOKEN over GH_TOKEN and gh", async () => {
    let ranGh = false;
    const { config, problems } = await load(
      { GITHUB_TOKEN: "ghp_a", GH_TOKEN: "ghp_b" },
      async () => {
        ranGh = true;
        return "ghp_c\n";
      },
    );
    expect(config.github).toEqual({ token: "ghp_a", source: "GITHUB_TOKEN" });
    expect(problems).toEqual([]);
    expect(ranGh).toBe(false);
  });

  it("falls back to GH_TOKEN", async () => {
    const { config } = await load({ GH_TOKEN: "ghp_b" });
    expect(config.github).toEqual({ token: "ghp_b", source: "GH_TOKEN" });
  });

  it("falls back to `gh auth token`, trimmed", async () => {
    const calls: (readonly string[])[] = [];
    const { config } = await load({}, async (file, args) => {
      calls.push([file, ...args]);
      return "gho_cli\n";
    });
    expect(config.github).toEqual({ token: "gho_cli", source: "gh auth token" });
    expect(calls).toEqual([["gh", "auth", "token"]]);
  });

  it("treats a blank variable as unset", async () => {
    const { config } = await load({ GITHUB_TOKEN: "  ", GH_TOKEN: " ghp_b\n" });
    expect(config.github).toEqual({ token: "ghp_b", source: "GH_TOKEN" });
  });

  it("is not configured when gh is missing or fails", async () => {
    const { config, problems } = await load({});
    expect(config.github).toBeNull();
    expect(problems).toEqual([NO_GIT_HOST]);
  });

  it("is not configured when gh prints nothing", async () => {
    const { config } = await load({}, async () => "\n");
    expect(config.github).toBeNull();
  });
});

describe("loadConfig: Bitbucket", () => {
  it("reads email, token and workspace", async () => {
    const { config, problems } = await load({
      BITBUCKET_EMAIL: "lee@example.com",
      BITBUCKET_API_TOKEN: "ATATT-x",
      BITBUCKET_WORKSPACE: "acme",
    });
    expect(config.bitbucket).toEqual({
      credential: "api token",
      username: "lee@example.com",
      password: "ATATT-x",
      workspace: "acme",
    });
    expect(config.github).toBeNull();
    expect(problems).toEqual([]);
  });

  it("has no workspace when it isn't set", async () => {
    const { config } = await load({ BITBUCKET_EMAIL: "lee@example.com", BITBUCKET_API_TOKEN: "x" });
    expect(config.bitbucket?.workspace).toBeNull();
  });

  it("reports an email without a token", async () => {
    const { config, problems } = await load({ ...GITHUB, BITBUCKET_EMAIL: "lee@example.com" });
    expect(config.bitbucket).toBeNull();
    expect(problems).toEqual(["Bitbucket is partly configured: also set BITBUCKET_API_TOKEN."]);
  });

  it("reports a token without an email, and no extra no-host problem", async () => {
    const { problems } = await load({ BITBUCKET_API_TOKEN: "x" });
    expect(problems).toEqual(["Bitbucket is partly configured: also set BITBUCKET_EMAIL."]);
  });

  it("reports a workspace without credentials", async () => {
    const { problems } = await load({ ...GITHUB, BITBUCKET_WORKSPACE: "acme" });
    expect(problems).toEqual([expect.stringContaining("BITBUCKET_WORKSPACE is set without")]);
  });

  it("reads a username and app password", async () => {
    const { config, problems } = await load({
      BITBUCKET_USERNAME: "lee",
      BITBUCKET_APP_PASSWORD: "app-password",
      BITBUCKET_WORKSPACE: "acme",
    });
    expect(config.bitbucket).toEqual({
      credential: "app password",
      username: "lee",
      password: "app-password",
      workspace: "acme",
    });
    expect(problems).toEqual([]);
  });

  it("prefers an API token to an app password", async () => {
    const { config } = await load({
      BITBUCKET_EMAIL: "lee@example.com",
      BITBUCKET_API_TOKEN: "ATATT-x",
      BITBUCKET_USERNAME: "lee",
      BITBUCKET_APP_PASSWORD: "app-password",
    });
    expect(config.bitbucket?.credential).toBe("api token");
  });

  it("ignores a stray username when an API token is set", async () => {
    const { problems } = await load({
      BITBUCKET_EMAIL: "lee@example.com",
      BITBUCKET_API_TOKEN: "ATATT-x",
      BITBUCKET_USERNAME: "lee",
    });
    expect(problems).toEqual([]);
  });

  it("reports an app password without a username, and no extra no-host problem", async () => {
    const { config, problems } = await load({
      BITBUCKET_APP_PASSWORD: "app-password",
      BITBUCKET_WORKSPACE: "acme",
    });
    expect(config.bitbucket).toBeNull();
    expect(problems).toEqual(["Bitbucket is partly configured: also set BITBUCKET_USERNAME."]);
  });
});

describe("loadConfig: Jira", () => {
  const JIRA = {
    JIRA_BASE_URL: "https://acme.atlassian.net/",
    JIRA_EMAIL: "lee@example.com",
    JIRA_API_TOKEN: "jira-token",
  };

  it("reads all three, with the base URL normalized", async () => {
    const { config, problems } = await load({ ...GITHUB, ...JIRA });
    expect(config.jira).toEqual({
      baseUrl: "https://acme.atlassian.net",
      email: "lee@example.com",
      apiToken: "jira-token",
    });
    expect(problems).toEqual([]);
  });

  it("is not configured with none of them", async () => {
    const { config } = await load(GITHUB);
    expect(config.jira).toBeNull();
  });

  it("reports a partial config", async () => {
    const { config, problems } = await load({ ...GITHUB, JIRA_BASE_URL: JIRA.JIRA_BASE_URL });
    expect(config.jira).toBeNull();
    expect(problems).toEqual([
      "Jira is partly configured: also set JIRA_EMAIL and JIRA_API_TOKEN.",
    ]);
  });

  it("reports a base URL that isn't https", async () => {
    const { config, problems } = await load({
      ...GITHUB,
      ...JIRA,
      JIRA_BASE_URL: "http://acme.atlassian.net",
    });
    expect(config.jira).toBeNull();
    expect(problems).toEqual([expect.stringContaining("JIRA_BASE_URL must start with https://")]);
  });
});

describe("loadConfig: home and log level", () => {
  it("defaults to ~/.megareviewer and warn", async () => {
    const { config } = await load(GITHUB);
    expect(config.home).toBe("/home/lee/.megareviewer");
    expect(config.logLevel).toBe("warn");
  });

  it("reads MEGAREVIEWER_HOME and MEGAREVIEWER_LOG", async () => {
    const { config } = await load({
      ...GITHUB,
      MEGAREVIEWER_HOME: "/tmp/mr",
      MEGAREVIEWER_LOG: "DEBUG",
    });
    expect(config.home).toBe("/tmp/mr");
    expect(config.logLevel).toBe("debug");
  });

  it("reports an unknown log level and keeps warn", async () => {
    const { config, problems } = await load({ ...GITHUB, MEGAREVIEWER_LOG: "verbose" });
    expect(config.logLevel).toBe("warn");
    expect(problems).toEqual(["MEGAREVIEWER_LOG must be one of debug, info, warn, error."]);
  });
});
