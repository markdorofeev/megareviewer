import { describe, expect, it } from "vitest";
import { codexStatus, parseCatalog } from "./codex-status.ts";
import type { CodexRun, RunCodex } from "./run-codex.ts";

const ran = (stdout: string, options: Partial<CodexRun> = {}): CodexRun => ({
  code: 0,
  started: true,
  lines: stdout === "" ? [] : stdout.split("\n"),
  stderr: "",
  killed: null,
  ...options,
});

// Trimmed from `codex debug models` on 0.162.0: two listed models and Codex's hidden reviewer.
const CATALOG = JSON.stringify(
  {
    models: [
      {
        slug: "gpt-6-sol",
        display_name: "GPT-6-Sol",
        visibility: "list",
        context_window: 272000,
        supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }],
      },
      {
        slug: "gpt-6-luna",
        display_name: "GPT-6-Luna",
        visibility: "list",
        context_window: 272000,
        supported_reasoning_levels: [{ effort: "low" }, { effort: "max" }],
      },
      { slug: "codex-auto-review", visibility: "hide", context_window: 272000 },
    ],
  },
  null,
  2,
);

const runWith =
  (answers: { version?: CodexRun; login?: CodexRun; models?: CodexRun }): RunCodex =>
  async (args) => {
    const [first, second] = typeof args === "function" ? args("/tmp") : args;
    if (first === "--version") return answers.version ?? ran("codex-cli 0.162.0");
    if (first === "login" && second === "status") {
      return answers.login ?? ran("", { stderr: "Logged in using ChatGPT" });
    }
    return answers.models ?? ran(CATALOG);
  };

describe("codexStatus", () => {
  it("is signed in with ChatGPT, on the plan, with the listed models", async () => {
    expect(await codexStatus(runWith({}))).toEqual({
      state: "signed-in",
      version: "0.162.0",
      billing: "plan",
      models: [
        { slug: "gpt-6-sol", contextWindow: 272000, efforts: ["low", "medium", "high"] },
        { slug: "gpt-6-luna", contextWindow: 272000, efforts: ["low", "max"] },
      ],
    });
  });

  it("bills the API when signed in with a key", async () => {
    const login = ran("", { stderr: "Logged in using an API key - sk-proj-***ABCD" });
    expect(await codexStatus(runWith({ login }))).toMatchObject({ billing: "api" });
  });

  it("is signed out, as recorded: exit 1 and 'Not logged in' on stderr", async () => {
    const login = ran("", { code: 1, stderr: "Not logged in" });
    expect(await codexStatus(runWith({ login }))).toEqual({
      state: "signed-out",
      version: "0.162.0",
    });
  });

  it("isn't installed when `codex` can't be started", async () => {
    const version = ran("", { started: false, code: null });
    expect(await codexStatus(runWith({ version }))).toEqual({ state: "not-installed" });
  });

  it("fails when a command gives nothing it can read", async () => {
    expect(await codexStatus(runWith({ version: ran("", { code: 2 }) }))).toMatchObject({
      state: "failed",
    });
    expect(await codexStatus(runWith({ login: ran("", { code: 3 }) }))).toMatchObject({
      state: "failed",
    });
    expect(await codexStatus(runWith({ models: ran("not json") }))).toMatchObject({
      state: "failed",
      message: expect.stringMatching(/debug models/),
    });
  });
});

describe("parseCatalog", () => {
  it("leaves out hidden models", () => {
    expect(parseCatalog(CATALOG)?.map((model) => model.slug)).toEqual(["gpt-6-sol", "gpt-6-luna"]);
  });
});
