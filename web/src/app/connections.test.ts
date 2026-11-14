import { describe, expect, it } from "vitest";
import type { StatusResponse } from "../../../contracts/index.ts";
import {
  fixtureModelOptions,
  fixtureStatus,
  lockedModelOptions,
  opencodeModelOptions,
} from "../../dev/fixtures/index.ts";
import { type ConnectionsInput, connectionsOf } from "./connections.ts";

const CODEX_MISSING = "Codex isn't installed: install the Codex CLI, then run `codex login`";

/** Codex's two models, able to run or not. */
const codex = (available: boolean): StatusResponse["model"]["options"] =>
  (
    [
      ["gpt-6-luna", "GPT-6 Luna"],
      ["gpt-6-sol", "GPT-6 Sol"],
    ] as const
  ).map(([model, modelName]) => ({
    id: `codex/${model}`,
    provider: "codex",
    providerName: "Codex",
    model,
    modelName,
    family: "GPT",
    via: available ? "Codex, on your ChatGPT plan" : "Codex",
    measured: true,
    available,
    reason: available ? null : CODEX_MISSING,
  }));

const NOW = Date.parse("2026-10-21T10:00:00Z");
const off = { configured: false, user: null, error: null };
const failingHost = { configured: true, user: null, error: "Bad credentials" };
const signedIn = { configured: true, user: { id: "sam", name: "Sam Rivera" }, error: null };

const status = (change: Partial<StatusResponse> = {}): StatusResponse => ({
  ...fixtureStatus,
  ...change,
});
const withHosts = (hosts: Partial<StatusResponse["hosts"]>) =>
  status({ hosts: { ...fixtureStatus.hosts, ...hosts } });

const input = (change: Partial<ConnectionsInput> = {}): ConnectionsInput => ({
  status: fixtureStatus,
  error: null,
  checking: false,
  checkedAtMs: NOW - 2 * 60_000,
  listed: null,
  nowMs: NOW,
  ...change,
});

const states = (connections: ReturnType<typeof connectionsOf>) =>
  connections.rows.map((row) => [row.name, row.state]);

describe("connectionsOf", () => {
  it("is all connected when all six work", () => {
    const all = connectionsOf(
      input({
        status: status({
          hosts: { ...fixtureStatus.hosts, bitbucket: signedIn },
          model: {
            ...opencodeModelOptions,
            options: [...opencodeModelOptions.options, ...codex(true)],
          },
        }),
      }),
    );
    expect(all.button).toEqual({
      label: "All connected",
      tone: "ok",
      name: "Connections: 6 working. Open for details.",
    });
    expect(all.summary).toBe("All 6 working · checked 2 min ago");
    expect(states(all)).toEqual([
      ["GitHub", "working"],
      ["Bitbucket", "working"],
      ["Claude", "working"],
      ["Codex", "working"],
      ["opencode", "working"],
      ["Jira", "working"],
    ]);
  });

  it("counts an unconfigured host as optional while the other works, with how to connect it", () => {
    const some = connectionsOf(input());
    expect(some.button).toEqual({
      label: "3 of 6 connected",
      tone: "ok",
      name: "Connections: 3 working · 3 optional. Open for details.",
    });
    expect(some.summary).toBe("3 working · 3 optional · checked 2 min ago");
    expect(some.rows[1]).toEqual({
      kind: "bitbucket",
      name: "Bitbucket",
      state: "optional",
      detail: "Lists and opens Bitbucket pull requests.",
      fix: "Set BITBUCKET_EMAIL and BITBUCKET_API_TOKEN, and BITBUCKET_WORKSPACE to list its pull requests, then restart megareviewer.",
    });
  });

  it("names the signed-in user and the PRs listed", () => {
    const listed = connectionsOf(
      input({ listed: { counts: { github: 7 }, atMs: NOW - 2 * 60_000 } }),
    );
    expect(listed.rows[0]?.detail).toBe("Lee Park · 7 pull requests listed 2 min ago");
    expect(connectionsOf(input()).rows[0]?.detail).toBe("Lee Park");
  });

  it("leaves Claude optional when no model can run, with the fix", () => {
    const locked = connectionsOf(input({ status: status({ model: lockedModelOptions }) }));
    const claude = locked.rows.find((row) => row.kind === "claude");
    expect(claude?.state).toBe("optional");
    expect(claude?.fix).toMatch(/^Claude Code isn't signed in.*; or No Anthropic API credentials/);
    expect(locked.button.tone).toBe("ok");
    expect(locked.button.label).toBe("2 of 6 connected");
  });

  it("names the default model and who pays when it can run", () => {
    expect(connectionsOf(input()).rows.find((row) => row.kind === "claude")?.detail).toBe(
      "Sonnet 5.5 through Claude Code, on your Pro plan",
    );
  });

  it("shows Codex as optional with its fix while it can't run, and its models once it can", () => {
    const row = (options: StatusResponse["model"]["options"]) =>
      connectionsOf(
        input({ status: status({ model: { ...fixtureModelOptions, options } }) }),
      ).rows.find((candidate) => candidate.kind === "codex");
    expect(row([...fixtureModelOptions.options, ...codex(false)])).toEqual({
      kind: "codex",
      name: "Codex",
      state: "optional",
      detail: "Adds OpenAI's GPT models to Request AI review, on your ChatGPT plan.",
      fix: CODEX_MISSING,
    });
    expect(row([...fixtureModelOptions.options, ...codex(true)])).toMatchObject({
      state: "working",
      detail: "GPT-6 Luna and GPT-6 Sol through Codex, on your ChatGPT plan",
    });
    // A server that lists no Codex option still shows the row, with how to connect it.
    expect(row(fixtureModelOptions.options)?.fix).toBe(
      "Install the Codex CLI and run `codex login`, then restart megareviewer.",
    );
  });

  it("shows opencode's models and the providers behind them", () => {
    const opencode = connectionsOf(input({ status: status({ model: opencodeModelOptions }) }));
    expect(opencode.rows.find((row) => row.kind === "opencode")).toMatchObject({
      state: "working",
      detail: "14 models through Anthropic and Ollama",
    });
  });

  it("leaves Jira optional without it", () => {
    const jira = connectionsOf(input({ status: status({ jira: { configured: false } }) }));
    expect(jira.rows.at(-1)).toMatchObject({ name: "Jira", state: "optional" });
  });

  it("puts a failing host first and turns the button red", () => {
    const failing = connectionsOf(input({ status: withHosts({ github: failingHost }) }));
    expect(states(failing)[0]).toEqual(["GitHub", "failing"]);
    expect(failing.rows[0]?.detail).toBe("Bad credentials");
    expect(failing.button).toEqual({
      label: "1 issue",
      tone: "danger",
      name: "Connections: 1 failing · 2 working. Open to fix.",
    });
    expect(failing.summary).toBe("1 failing · 2 working");
  });

  it("marks both hosts not connected when neither is configured, in amber", () => {
    const none = connectionsOf(input({ status: withHosts({ github: off }) }));
    expect(states(none).slice(0, 2)).toEqual([
      ["GitHub", "not-connected"],
      ["Bitbucket", "not-connected"],
    ]);
    expect(none.button).toMatchObject({ label: "2 issues", tone: "warning" });
    expect(none.summary).toBe("2 not connected · 2 working");
  });

  it("turns red when any of several issues is failing", () => {
    const both = connectionsOf(
      input({ status: withHosts({ github: failingHost, bitbucket: failingHost }) }),
    );
    expect(both.button).toMatchObject({ label: "2 issues", tone: "danger" });
    expect(states(both).slice(0, 2)).toEqual([
      ["GitHub", "failing"],
      ["Bitbucket", "failing"],
    ]);
  });

  it("checks before the first read, with no details", () => {
    const first = connectionsOf(input({ status: null, checking: true }));
    expect(first.button).toMatchObject({ label: "Checking…", tone: "checking" });
    expect(first.summary).toBe("Checking 6 connections…");
    expect(first.rows.every((row) => row.state === "checking" && row.detail === "")).toBe(true);
  });

  it("keeps each row's last detail while checking again", () => {
    const again = connectionsOf(input({ checking: true }));
    expect(again.button.label).toBe("Checking…");
    expect(again.rows[0]).toMatchObject({ state: "checking", detail: "Lee Park" });
  });

  it("is disconnected when the status request failed", () => {
    const down = connectionsOf(
      input({ status: null, error: { code: "unreachable", message: "Can't reach it." } }),
    );
    expect(down.button).toMatchObject({ label: "Disconnected", tone: "danger" });
    expect(down.rows).toEqual([]);
    expect(down.disconnected).toBe("Can't reach it.");
  });
});
