import { describe, expect, it } from "vitest";
import { fixtureStatus } from "../../../dev/fixtures/index.ts";
import { relativeTime } from "./relative-time.ts";
import { setupItems } from "./setup.ts";

describe("setupItems", () => {
  it("names the signed-in user and the fix for what's missing", () => {
    expect(setupItems(fixtureStatus)).toEqual([
      { name: "GitHub", state: "ok", text: "Lee Park" },
      {
        name: "Bitbucket",
        state: "optional",
        text: "Not configured: set BITBUCKET_EMAIL and BITBUCKET_API_TOKEN",
      },
      { name: "Jira", state: "ok", text: "Configured" },
      {
        name: "Claude",
        state: "ok",
        text: "Claude Code, on your Pro plan: Analyze with Claude on a review adds intent, decisions and the tour's titles",
      },
    ]);
  });

  it("marks missing what megareviewer can't work without", () => {
    const off = { configured: false, user: null, error: null };
    const items = setupItems({
      ...fixtureStatus,
      hosts: { github: off, bitbucket: off },
      jira: { configured: false },
      model: {
        available: false,
        via: null,
        reason: "Claude Code isn't installed; or set ANTHROPIC_API_KEY to use the Anthropic API.",
      },
    });
    expect(items.map((item) => [item.name, item.state])).toEqual([
      ["GitHub", "missing"],
      ["Bitbucket", "missing"],
      ["Jira", "optional"],
      ["Claude", "optional"],
    ]);
    expect(items[0]?.text).toBe("Not configured: set GITHUB_TOKEN or run gh auth login");
    expect(items[3]?.text).toBe(
      "Unavailable: Claude Code isn't installed; or set ANTHROPIC_API_KEY to use the Anthropic API.",
    );
  });

  it("shows a configured host's error", () => {
    const github = { configured: true, user: null, error: "Bad credentials" };
    expect(setupItems({ ...fixtureStatus, hosts: { ...fixtureStatus.hosts, github } })[0]).toEqual({
      name: "GitHub",
      state: "error",
      text: "Bad credentials",
    });
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-10-22T12:00:00Z");

  it.each([
    ["2026-10-22T11:59:30Z", "just now"],
    ["2026-10-22T11:55:00Z", "5 minutes ago"],
    ["2026-10-22T09:00:00Z", "3 hours ago"],
    ["2026-10-21T10:00:00Z", "yesterday"],
    ["2026-10-08T12:00:00Z", "2 weeks ago"],
    ["2026-07-22T12:00:00Z", "3 months ago"],
    ["2024-10-22T12:00:00Z", "2 years ago"],
  ])("shows %s as %s", (timestamp, expected) => {
    expect(relativeTime(timestamp, now)).toBe(expected);
  });
});
