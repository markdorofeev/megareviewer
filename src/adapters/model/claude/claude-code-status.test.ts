import { describe, expect, it } from "vitest";
import { claudeCodeStatus, compareVersions, planName } from "./claude-code-status.ts";
import type { ClaudeRun, RunClaude } from "./run-claude.ts";

const ran = (stdout: string, code = 0): ClaudeRun => ({
  code,
  started: true,
  lines: stdout.split("\n"),
  stderr: "",
  killed: null,
});

const runWith =
  (auth: ClaudeRun, version: ClaudeRun = ran("2.1.303 (Claude Code)")): RunClaude =>
  async (args) =>
    args[0] === "--version" ? version : auth;

describe("claudeCodeStatus", () => {
  it("is signed in to a plan", async () => {
    const auth = ran(
      JSON.stringify({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "pro" }, null, 2),
    );
    expect(await claudeCodeStatus(runWith(auth))).toEqual({
      state: "signed-in",
      version: "2.1.303",
      plan: "pro",
      billing: "plan",
    });
  });

  it("bills the API when signed in to a Console account", async () => {
    const auth = ran(JSON.stringify({ loggedIn: true, authMethod: "console" }));
    expect(await claudeCodeStatus(runWith(auth))).toMatchObject({ plan: null, billing: "api" });
  });

  it("is signed out, as `claude auth status` says with exit code 1", async () => {
    const auth = ran(JSON.stringify({ loggedIn: false, authMethod: "none" }), 1);
    expect(await claudeCodeStatus(runWith(auth))).toEqual({
      state: "signed-out",
      version: "2.1.303",
    });
  });

  it("isn't installed", async () => {
    const missing: RunClaude = async () => ({ ...ran(""), started: false, code: null, lines: [] });
    expect(await claudeCodeStatus(missing)).toEqual({ state: "not-installed" });
  });

  it("fails when the status isn't JSON", async () => {
    expect(await claudeCodeStatus(runWith(ran("Unknown command: auth", 1)))).toMatchObject({
      state: "failed",
    });
  });
});

describe("compareVersions", () => {
  it("compares each number", () => {
    expect(compareVersions("2.1.303", "2.1.303")).toBe(0);
    expect(compareVersions("2.1.99", "2.1.303")).toBe(-1);
    expect(compareVersions("2.2.0", "2.1.303")).toBe(1);
  });
});

describe("planName", () => {
  it("names the plan", () => {
    expect(planName("max")).toBe("your Max plan");
    expect(planName(null)).toBe("your Claude plan");
  });
});
