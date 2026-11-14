import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { ClaudeCodeStatus, RunClaude } from "../adapters/model/index.ts";
import { fakeModelOption, RecordingLogger } from "../application/testing/index.ts";
import {
  anthropicConfigured,
  createModelCatalog,
  describeClaudeCode,
  modelSummary,
  NO_ANTHROPIC_CREDENTIALS,
} from "./model-access.ts";

const signedIn: ClaudeCodeStatus = {
  state: "signed-in",
  version: "2.1.303",
  plan: "pro",
  billing: "plan",
};
const signedOut: ClaudeCodeStatus = { state: "signed-out", version: "2.1.303" };
const old: ClaudeCodeStatus = { ...signedIn, version: "2.0.9" };

const NOT_SIGNED_IN = "Claude Code isn't signed in: run `claude` and sign in";
const NOT_INSTALLED =
  "Claude Code isn't installed: install it (https://code.claude.com), then run `claude` and sign in";
const TOO_OLD = "Claude Code 2.0.9 is older than 2.1.303: run `claude update`";
const NO_API = `No Anthropic API credentials: ${NO_ANTHROPIC_CREDENTIALS}`;

const neverRun: RunClaude = async () => {
  throw new Error("the probe answers for Claude Code");
};

/** A catalog whose probes answer in turn from `claudeCode` and `api`, the last one repeating. */
const catalogWith = (
  claudeCode: readonly (ClaudeCodeStatus | "hang")[],
  api: readonly boolean[],
  timeoutMs?: number,
) => {
  const asked = { claudeCode: 0, api: 0 };
  const next = <T>(answers: readonly T[], count: number): T => {
    const answer = answers[Math.min(count, answers.length - 1)];
    if (answer === undefined) throw new Error("no answer");
    return answer;
  };
  const catalog = createModelCatalog({
    runClaude: neverRun,
    client: new Anthropic({ apiKey: "sk-ant-test" }),
    logger: new RecordingLogger(),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    probe: {
      claudeCode: () => {
        const answer = next(claudeCode, asked.claudeCode++);
        return answer === "hang" ? new Promise(() => {}) : Promise.resolve(answer);
      },
      apiConfigured: async () => next(api, asked.api++),
    },
  });
  return { catalog, asked };
};

/** Each option as "provider/model: reason", or without the reason when it can run. */
const summary = async (catalog: ReturnType<typeof catalogWith>["catalog"]) => {
  const { options, defaultId } = await catalog.options();
  return {
    defaultId,
    options: options.map(
      (option) =>
        `${option.id}${option.available ? "" : `: ${option.reason}`}${option.available ? ` (${option.via})` : ""}`,
    ),
  };
};

const models = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"];
const listed = (provider: string, suffix: string) =>
  models.map((model) => `${provider}/${model}${suffix}`);

describe("createModelCatalog", () => {
  it.each([
    {
      name: "Claude Code signed in, with API credentials",
      claudeCode: signedIn,
      api: true,
      claudeCodeSuffix: " (Claude Code, on your Pro plan)",
      apiSuffix: " (Anthropic API, billed to your account)",
      defaultId: "claude-code/claude-sonnet-5-5",
    },
    {
      name: "Claude Code signed in, without API credentials",
      claudeCode: signedIn,
      api: false,
      claudeCodeSuffix: " (Claude Code, on your Pro plan)",
      apiSuffix: `: ${NO_API}`,
      defaultId: "claude-code/claude-sonnet-5-5",
    },
    {
      name: "Claude Code signed out, with API credentials",
      claudeCode: signedOut,
      api: true,
      claudeCodeSuffix: `: ${NOT_SIGNED_IN}`,
      apiSuffix: " (Anthropic API, billed to your account)",
      defaultId: "anthropic-api/claude-sonnet-5-5",
    },
    {
      name: "Claude Code signed out, without API credentials",
      claudeCode: signedOut,
      api: false,
      claudeCodeSuffix: `: ${NOT_SIGNED_IN}`,
      apiSuffix: `: ${NO_API}`,
      defaultId: "claude-code/claude-sonnet-5-5",
    },
    {
      name: "Claude Code too old, with API credentials",
      claudeCode: old,
      api: true,
      claudeCodeSuffix: `: ${TOO_OLD}`,
      apiSuffix: " (Anthropic API, billed to your account)",
      defaultId: "anthropic-api/claude-sonnet-5-5",
    },
    {
      name: "Claude Code too old, without API credentials",
      claudeCode: old,
      api: false,
      claudeCodeSuffix: `: ${TOO_OLD}`,
      apiSuffix: `: ${NO_API}`,
      defaultId: "claude-code/claude-sonnet-5-5",
    },
    {
      name: "Claude Code missing, with API credentials",
      claudeCode: { state: "not-installed" } as const,
      api: true,
      claudeCodeSuffix: `: ${NOT_INSTALLED}`,
      apiSuffix: " (Anthropic API, billed to your account)",
      defaultId: "anthropic-api/claude-sonnet-5-5",
    },
    {
      name: "Claude Code missing, without API credentials",
      claudeCode: { state: "not-installed" } as const,
      api: false,
      claudeCodeSuffix: `: ${NOT_INSTALLED}`,
      apiSuffix: `: ${NO_API}`,
      defaultId: "claude-code/claude-sonnet-5-5",
    },
  ])("lists every option, with $name", async (expected) => {
    const { catalog } = catalogWith([expected.claudeCode], [expected.api]);
    expect(await summary(catalog)).toEqual({
      defaultId: expected.defaultId,
      options: [
        ...listed("claude-code", expected.claudeCodeSuffix),
        ...listed("anthropic-api", expected.apiSuffix),
      ],
    });
  });

  it("names each model, its provider and family, and that the evals measured it", async () => {
    const { catalog } = catalogWith([signedIn], [false]);
    const { options } = await catalog.options();
    expect(options[1]).toEqual({
      id: "claude-code/claude-sonnet-5-5",
      provider: "claude-code",
      providerName: "Claude Code",
      model: "claude-sonnet-5-5",
      modelName: "Sonnet 5.5",
      family: "Claude",
      via: "Claude Code, on your Pro plan",
      measured: true,
      available: true,
      reason: null,
    });
  });

  it("keeps a provider that can run, and asks again about one that can't", async () => {
    const { catalog, asked } = catalogWith([signedOut, signedIn], [true]);
    expect((await summary(catalog)).defaultId).toBe("anthropic-api/claude-sonnet-5-5");
    expect((await summary(catalog)).defaultId).toBe("claude-code/claude-sonnet-5-5");
    await Promise.all([catalog.options(), catalog.options()]);
    expect(asked).toEqual({ claudeCode: 2, api: 1 });
  });

  it("asks each provider once for requests at the same time", async () => {
    const { catalog, asked } = catalogWith([signedOut], [false]);
    await Promise.all([catalog.options(), catalog.options()]);
    expect(asked).toEqual({ claudeCode: 1, api: 1 });
  });

  it("disables a provider that doesn't answer in time, without holding the others", async () => {
    const { catalog } = catalogWith(["hang"], [true], 20);
    const started = performance.now();
    const { options, defaultId } = await catalog.options();
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(options[0]).toMatchObject({
      available: false,
      reason: "Claude Code didn't say whether it can run within 0.02 seconds",
    });
    expect(defaultId).toBe("anthropic-api/claude-sonnet-5-5");
  });

  it("serves the passes on an option once its provider can run, on that option's model", async () => {
    const { catalog } = catalogWith([signedIn], [false]);
    expect(catalog.model("claude-code/claude-opus-5-5")).toBeNull();
    await catalog.options();
    expect(catalog.model("claude-code/claude-opus-5-5")?.version).toMatch(
      /^claude-code\/claude-opus-5-5\/p\d+$/,
    );
    expect(catalog.model("anthropic-api/claude-opus-5-5")).toBeNull();
    expect(catalog.model("claude-code/claude-nothing")).toBeNull();
    expect(catalog.model("nobody/claude-opus-5-5")).toBeNull();
  });

  it("runs the API's options on the API, on their model", async () => {
    const { catalog } = catalogWith([signedOut], [true]);
    await catalog.options();
    expect(catalog.model("anthropic-api/claude-haiku-5-5")?.version).toMatch(
      /^claude-haiku-5-5\/p\d+$/,
    );
  });
});

describe("describeClaudeCode", () => {
  it("says who pays", () => {
    expect(describeClaudeCode({ plan: "pro", billing: "plan" })).toBe(
      "Claude Code, on your Pro plan",
    );
    expect(describeClaudeCode({ plan: null, billing: "api" })).toBe(
      "Claude Code, billed to your Anthropic Console account",
    );
  });
});

describe("modelSummary", () => {
  const haiku = fakeModelOption({ model: "claude-haiku-5-5", modelName: "Haiku 5.5" });
  const sonnet = fakeModelOption();

  it("names the default and who pays, and how many more there are", () => {
    expect(modelSummary({ options: [haiku, sonnet], defaultId: sonnet.id })).toBe(
      "Sonnet 5.5 through Claude Code, on your Pro plan, or 1 more in Request AI review's menu",
    );
  });

  it("gives each provider's reason once when nothing can run", () => {
    const off = (option: typeof haiku, reason: string) => ({ ...option, available: false, reason });
    expect(
      modelSummary({
        options: [off(haiku, NOT_SIGNED_IN), off(sonnet, NOT_SIGNED_IN), off(sonnet, NO_API)],
        defaultId: sonnet.id,
      }),
    ).toBe(`unavailable: ${NOT_SIGNED_IN}; or ${NO_API}`);
  });
});

describe("anthropicConfigured", () => {
  it("counts an API key as configured", async () => {
    expect(
      await anthropicConfigured(new Anthropic({ apiKey: "sk-ant-test" }), new RecordingLogger()),
    ).toBe(true);
  });
});
