import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { ClaudeCodeStatus, RunClaude } from "../adapters/claude/index.ts";
import { RecordingLogger, smallFeatureInput } from "../application/testing/index.ts";
import {
  anthropicConfigured,
  createModelAccess,
  describeTransport,
  NO_ANTHROPIC_CREDENTIALS,
  selectTransport,
} from "./model-access.ts";

const signedIn: ClaudeCodeStatus = {
  state: "signed-in",
  version: "2.1.303",
  plan: "pro",
  billing: "plan",
};
const claudeCode = { kind: "claude-code", version: "2.1.303", plan: "pro", billing: "plan" };

describe("selectTransport", () => {
  it("runs on Claude Code when it's signed in, whatever the API has", () => {
    expect(selectTransport(signedIn, true)).toEqual({ ok: true, value: claudeCode });
  });

  it("falls back to the API when Claude Code isn't there", () => {
    expect(selectTransport({ state: "not-installed" }, true)).toEqual({
      ok: true,
      value: { kind: "api" },
    });
  });

  it("names both fixes when neither can run the passes", () => {
    expect(selectTransport({ state: "signed-out", version: "2.1.303" }, false)).toEqual({
      ok: false,
      error: `Claude Code isn't signed in: run \`claude\` and sign in; or ${NO_ANTHROPIC_CREDENTIALS}.`,
    });
  });

  it("doesn't use a Claude Code older than the one recorded", () => {
    const old = { ...signedIn, version: "2.0.9" };
    expect(selectTransport(old, true)).toEqual({ ok: true, value: { kind: "api" } });
    expect(selectTransport(old, false)).toEqual({
      ok: false,
      error: expect.stringContaining(
        "Claude Code 2.0.9 is older than 2.1.303: run `claude update`",
      ),
    });
  });

  it("says who pays", () => {
    expect(
      describeTransport({ kind: "claude-code", version: "2.1.303", plan: "pro", billing: "plan" }),
    ).toBe("Claude Code, on your Pro plan");
    expect(
      describeTransport({ kind: "claude-code", version: "2.1.303", plan: null, billing: "api" }),
    ).toBe("Claude Code, billed to your Anthropic Console account");
    expect(describeTransport({ kind: "api" })).toBe("Anthropic API, billed to your account");
  });
});

describe("anthropicConfigured", () => {
  it("counts an API key as configured", async () => {
    const client = new Anthropic({ apiKey: "sk-ant-test" });
    expect(await anthropicConfigured(client, new RecordingLogger())).toBe(true);
  });
});

describe("createModelAccess", () => {
  const neverRun: RunClaude = async () => {
    throw new Error("the probe answers for Claude Code");
  };
  const accessWith = (answers: { claudeCode: ClaudeCodeStatus; apiConfigured: boolean }[]) => {
    let probes = 0;
    const access = createModelAccess({
      runClaude: neverRun,
      client: new Anthropic({ apiKey: "sk-ant-test" }),
      logger: new RecordingLogger(),
      probe: async () => {
        const answer = answers[Math.min(probes, answers.length - 1)];
        probes += 1;
        if (answer === undefined) throw new Error("no answer");
        return answer;
      },
    });
    return { access, probes: () => probes };
  };

  it("picks once, when first asked, and keeps it", async () => {
    const { access, probes } = accessWith([{ claudeCode: signedIn, apiConfigured: false }]);
    expect(probes()).toBe(0);
    const [first, second] = await Promise.all([access.availability(), access.availability()]);
    expect(first).toEqual({ available: true, via: "Claude Code, on your Pro plan" });
    expect(second).toEqual(first);
    await access.availability();
    expect(probes()).toBe(1);
    expect(access.model.version).toMatch(/^claude-code\//);
  });

  it("asks again while nothing can run, so signing in needs no restart", async () => {
    const { access, probes } = accessWith([
      { claudeCode: { state: "signed-out", version: "2.1.303" }, apiConfigured: false },
      { claudeCode: signedIn, apiConfigured: false },
    ]);
    expect(await access.availability()).toMatchObject({ available: false });
    expect(await access.availability()).toMatchObject({ available: true });
    expect(probes()).toBe(2);
  });

  it("fails a pass with the reason when nothing can run it", async () => {
    const { access } = accessWith([
      { claudeCode: { state: "not-installed" }, apiConfigured: false },
    ]);
    const result = await access.model.checkSize(smallFeatureInput);
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "unauthorized",
        message: expect.stringMatching(/^Claude can't run: Claude Code isn't installed/),
      },
    });
  });
});
