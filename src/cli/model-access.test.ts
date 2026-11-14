import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type {
  ClaudeCodeStatus,
  CodexStatus,
  OpencodeModel,
  OpencodeStatus,
  RunClaude,
} from "../adapters/model/index.ts";
import { fakeModelOption, RecordingLogger } from "../application/testing/index.ts";
import {
  anthropicConfigured,
  codexModels,
  createModelCatalog,
  describeClaudeCode,
  describeCodex,
  modelSummary,
  NO_ANTHROPIC_CREDENTIALS,
  OPENCODE_NOT_INSTALLED,
  opencodeModels,
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

const codexSignedIn: CodexStatus = {
  state: "signed-in",
  version: "0.162.0",
  billing: "plan",
  models: [
    { slug: "gpt-6-sol", contextWindow: 272_000, efforts: ["low", "medium", "high"] },
    { slug: "gpt-6-luna", contextWindow: 272_000, efforts: ["low", "medium", "high"] },
    { slug: "gpt-6-astra", contextWindow: 272_000, efforts: ["low", "medium", "high"] },
  ],
};
const CODEX_MISSING = "Codex isn't installed: install the Codex CLI, then run `codex login`";
const OPENCODE_MISSING = `opencode/models: ${OPENCODE_NOT_INSTALLED}`;

const opencodeModel = (
  providerID: string,
  providerName: string,
  id: string,
  name: string,
): OpencodeModel => ({
  providerID,
  providerName,
  id,
  name,
  variants: ["low", "medium", "high"],
  contextTokens: 200_000,
  priced: true,
});
const opencodeRunning: OpencodeStatus = {
  state: "running",
  version: "2.3.0",
  models: [
    opencodeModel("anthropic", "Anthropic", "claude-haiku-5-5", "Claude Haiku 5.5"),
    opencodeModel("ollama", "Ollama", "qwen3-coder:30b", "Qwen3 Coder 30B"),
    opencodeModel("odd", "Odd", "model with spaces", "Odd model"),
  ],
  defaultModel: "ollama/qwen3-coder:30b",
};

const neverRun: RunClaude = async () => {
  throw new Error("the probe answers for Claude Code");
};

/** A catalog whose probes answer in turn from `claudeCode` and `api`, the last one repeating. */
const catalogWith = (
  claudeCode: readonly (ClaudeCodeStatus | "hang")[],
  api: readonly boolean[],
  timeoutMs?: number,
  codex: CodexStatus = { state: "not-installed" },
  opencode: OpencodeStatus = { state: "not-installed" },
) => {
  const asked = { claudeCode: 0, api: 0 };
  const next = <T>(answers: readonly T[], count: number): T => {
    const answer = answers[Math.min(count, answers.length - 1)];
    if (answer === undefined) throw new Error("no answer");
    return answer;
  };
  const catalog = createModelCatalog({
    runClaude: neverRun,
    runCodex: async () => {
      throw new Error("the probe answers for Codex");
    },
    client: new Anthropic({ apiKey: "sk-ant-test" }),
    logger: new RecordingLogger(),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    probe: {
      claudeCode: () => {
        const answer = next(claudeCode, asked.claudeCode++);
        return answer === "hang" ? new Promise(() => {}) : Promise.resolve(answer);
      },
      apiConfigured: async () => next(api, asked.api++),
      codex: async () => codex,
      opencode: async () => opencode,
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
        `codex/gpt-6-luna: ${CODEX_MISSING}`,
        `codex/gpt-6-sol: ${CODEX_MISSING}`,
        OPENCODE_MISSING,
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

describe("Codex's options", () => {
  it("lists the measured models the account offers, on the ChatGPT plan, default Sol when alone", async () => {
    const { catalog } = catalogWith([signedOut], [false], undefined, codexSignedIn);
    expect(await summary(catalog)).toEqual({
      defaultId: "codex/gpt-6-sol",
      options: [
        ...listed("claude-code", `: ${NOT_SIGNED_IN}`),
        ...listed("anthropic-api", `: ${NO_API}`),
        "codex/gpt-6-luna (Codex, on your ChatGPT plan)",
        "codex/gpt-6-sol (Codex, on your ChatGPT plan)",
        OPENCODE_MISSING,
      ],
    });
    const { options } = await catalog.options();
    expect(options.find((option) => option.id === "codex/gpt-6-sol")).toMatchObject({
      family: "GPT",
      modelName: "GPT-6 Sol",
      measured: true,
    });
  });

  it("leaves out a measured model the account's catalog doesn't have", () => {
    expect(codexModels([{ slug: "gpt-6-sol", contextWindow: null, efforts: [] }])).toEqual([
      { id: "gpt-6-sol", name: "GPT-6 Sol", family: "GPT" },
    ]);
    expect(codexModels(null).map((model) => model.id)).toEqual(["gpt-6-luna", "gpt-6-sol"]);
  });

  it.each<[CodexStatus, string]>([
    [{ state: "signed-out", version: "0.162.0" }, "Codex isn't signed in: run `codex login`"],
    [
      { ...codexSignedIn, version: "0.150.2" },
      "Codex 0.150.2 is older than 0.162.0: run `codex update`",
    ],
    [
      { state: "failed", message: "`codex --version` failed: boom" },
      "`codex --version` failed: boom",
    ],
  ])("disables its options with the fix", async (status, reason) => {
    const { catalog } = catalogWith([signedIn], [false], undefined, status);
    const { options, defaultId } = await catalog.options();
    expect(options.filter((option) => option.provider === "codex")).toEqual([
      expect.objectContaining({ available: false, reason }),
      expect.objectContaining({ available: false, reason }),
    ]);
    expect(defaultId).toBe("claude-code/claude-sonnet-5-5");
  });

  it("serves the passes on Codex once it can run, on the model chosen", async () => {
    const { catalog } = catalogWith([signedOut], [false], undefined, codexSignedIn);
    expect(catalog.model("codex/gpt-6-luna")).toBeNull();
    await catalog.options();
    expect(catalog.model("codex/gpt-6-luna")?.version).toMatch(/^codex\/gpt-6-luna\/p\d+$/);
    expect(catalog.model("codex/gpt-6-astra")).toBeNull();
  });

  it("says who pays", () => {
    expect(describeCodex("plan")).toBe("Codex, on your ChatGPT plan");
    expect(describeCodex("api")).toBe("Codex, billed to your OpenAI account");
  });
});

describe("opencode's options", () => {
  const withOpencode = (status: OpencodeStatus) =>
    catalogWith([signedOut], [false], undefined, { state: "not-installed" }, status);

  it("lists every model it offers, unmeasured, each through its own provider", async () => {
    const { catalog } = withOpencode(opencodeRunning);
    const { options, defaultId } = await catalog.options();
    expect(options.filter((option) => option.provider === "opencode")).toEqual([
      expect.objectContaining({
        id: "opencode/anthropic/claude-haiku-5-5",
        modelName: "Claude Haiku 5.5",
        family: "Claude",
        via: "opencode, through Anthropic",
        measured: false,
        available: true,
      }),
      expect.objectContaining({
        id: "opencode/ollama/qwen3-coder:30b",
        via: "opencode, through Ollama",
        family: "Qwen3",
      }),
    ]);
    // The only provider that can run, so its own default is the run's.
    expect(defaultId).toBe("opencode/ollama/qwen3-coder:30b");
  });

  it("leaves out a model whose ID an option can't carry", () => {
    expect(opencodeModels(opencodeRunning.models).map((model) => model.id)).toEqual([
      "anthropic/claude-haiku-5-5",
      "ollama/qwen3-coder:30b",
    ]);
  });

  it.each<[OpencodeStatus, string]>([
    [{ state: "not-installed" }, OPENCODE_NOT_INSTALLED],
    [
      { ...opencodeRunning, models: [], defaultModel: null },
      "opencode has no provider connected: run `opencode auth login`",
    ],
    [
      { state: "outdated", version: "1.19.5" },
      "opencode 1.19.5 is older than 2.3.0: run `opencode upgrade`",
    ],
    [{ state: "failed", message: "`opencode serve` exited (1): boom" }, "`opencode serve` exited (1): boom"],
  ])("is one disabled row with the fix when it can't run", async (status, reason) => {
    const { catalog } = withOpencode(status);
    const { options } = await catalog.options();
    expect(options.filter((option) => option.provider === "opencode")).toEqual([
      expect.objectContaining({ id: "opencode/models", available: false, reason }),
    ]);
  });

  it("serves the passes on a model it offers, once it can run", async () => {
    const { catalog } = withOpencode(opencodeRunning);
    expect(catalog.model("opencode/anthropic/claude-haiku-5-5")).toBeNull();
    await catalog.options();
    expect(catalog.model("opencode/anthropic/claude-haiku-5-5")?.version).toMatch(
      /^opencode\/anthropic\/claude-haiku-5-5\/p\d+$/,
    );
    expect(catalog.model("opencode/anthropic/claude-opus-9")).toBeNull();
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
