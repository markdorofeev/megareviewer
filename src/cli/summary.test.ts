import { describe, expect, it } from "vitest";
import type { Config } from "./config.ts";
import { startSummary } from "./summary.ts";

const CONFIG: Config = {
  github: { token: "ghp_x", source: "gh auth token" },
  bitbucket: null,
  jira: null,
  home: "/home/lee/.megareviewer",
  logLevel: "info",
};

const summary = (overrides: Partial<Parameters<typeof startSummary>[0]> = {}) =>
  startSummary({
    version: "1.2.3",
    config: CONFIG,
    model: { options: [], defaultId: "claude-code/claude-sonnet-5-5" },
    checkout: {
      root: "/home/lee/src/shop",
      repos: [{ host: "github", owner: "acme", repo: "shop" }],
    },
    walk: { clones: [], stopped: null },
    downloadFolder: "/home/lee/.megareviewer/repos",
    url: "http://127.0.0.1:4823/?token=t",
    ui: true,
    ...overrides,
  }).split("\n");

const line = (name: string, overrides?: Parameters<typeof summary>[0]) =>
  summary(overrides).find((one) => one.startsWith(`  ${name} `));

describe("startSummary", () => {
  it("says where it read what, and the link", () => {
    expect(summary()).toEqual([
      "megareviewer 1.2.3",
      "  GitHub     token from gh auth token",
      "  Bitbucket  not configured",
      "  Jira       not configured: ticket keys aren't fetched",
      "  Model      unavailable: no model is known",
      "  Checkout   /home/lee/src/shop (github.com/acme/shop)",
      "  Clones     your home folder is searched for a PR's repository: 0 clones found. --no-search turns this off",
      "  Download   when no clone has a PR's head commit, it's downloaded into /home/lee/.megareviewer/repos. --no-download turns this off",
      "",
      "Open http://127.0.0.1:4823/?token=t",
      "Press Ctrl+C to stop.",
    ]);
  });

  it("says how many clones the search found, and that it stopped early", () => {
    const clone = { dir: "/home/lee/src/app", repos: [] };
    expect(line("Clones", { walk: { clones: [clone, clone], stopped: "clones" } })).toBe(
      "  Clones     your home folder is searched for a PR's repository: 2 clones found. The search stopped early: it found 2,000 clones. --no-search turns this off",
    );
  });

  it("says the search is off, and then how else to show callers", () => {
    const off = { walk: null, checkout: null, downloadFolder: null };
    expect(line("Clones", off)).toBe("  Clones     not searched for, with --no-search");
    expect(line("Checkout", off)).toBe(
      "  Checkout   none: start in a checkout of the PR's repository, or pass --checkout, to show callers outside the PR",
    );
  });

  it("says a repository is looked for when it isn't started in a checkout", () => {
    expect(line("Checkout", { checkout: null })).toBe(
      "  Checkout   none here, so a PR's repository is looked for on this machine",
    );
  });

  it("says a repository is downloaded when nothing on this machine is looked at, or that it's off", () => {
    expect(line("Checkout", { checkout: null, walk: null })).toBe(
      "  Checkout   none here, so a PR's repository is downloaded",
    );
    expect(line("Download", { downloadFolder: null })).toBe("  Download   off, with --no-download");
  });
});
