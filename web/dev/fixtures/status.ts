import type { StatusResponse } from "../../../contracts/index.ts";
import type { ModelOption, ModelOptions } from "../../../src/domain/review/index.ts";

const MODELS = [
  ["claude-haiku-5-5", "Haiku 5.5"],
  ["claude-sonnet-5-5", "Sonnet 5.5"],
  ["claude-opus-5-5", "Opus 5.5"],
] as const;

export const NOT_SIGNED_IN = "Claude Code isn't signed in: run `claude` and sign in";
export const NO_API_CREDENTIALS =
  "No Anthropic API credentials: set ANTHROPIC_API_KEY or run `ant auth login` to use the Anthropic API";

const options = (
  provider: ModelOption["provider"],
  providerName: string,
  can: { readonly via: string } | { readonly reason: string },
): ModelOption[] =>
  MODELS.map(([model, modelName]) => ({
    id: `${provider}/${model}`,
    provider,
    providerName,
    model,
    modelName,
    family: "Claude",
    via: "via" in can ? can.via : providerName,
    measured: true,
    available: "via" in can,
    reason: "reason" in can ? can.reason : null,
  }));

/** Signed in to Claude Code on a Pro plan, without API credentials. */
export const fixtureModelOptions: ModelOptions = {
  options: [
    ...options("claude-code", "Claude Code", { via: "Claude Code, on your Pro plan" }),
    ...options("anthropic-api", "Anthropic API", { reason: NO_API_CREDENTIALS }),
  ],
  defaultId: "claude-code/claude-sonnet-5-5",
};

const OPENCODE_ANTHROPIC = [
  ["claude-haiku-5-5", "Claude Haiku 5.5"],
  ["claude-sonnet-5-5", "Claude Sonnet 5.5"],
  ["claude-opus-5-5", "Claude Opus 5.5"],
  ["claude-opus-5-5-fast", "Claude Opus 5.5 Fast"],
  ["claude-fable-5-2", "Claude Fable 5.2"],
  ["claude-fable-5-2-fast", "Claude Fable 5.2 Fast"],
  ["claude-fable-5-1", "Claude Fable 5.1"],
  ["claude-opus-5", "Claude Opus 5"],
  ["claude-sonnet-5", "Claude Sonnet 5"],
  ["claude-haiku-5", "Claude Haiku 5"],
  ["claude-sonnet-4-6", "Claude Sonnet 4.6"],
  ["claude-haiku-4-5", "Claude Haiku 4.5"],
] as const;

const OPENCODE_OLLAMA = [
  ["qwen3-coder:30b", "Qwen3 Coder 30B"],
  ["llama3.3:70b", "Llama 3.3 70B"],
] as const;

const opencodeOptions = (
  providerID: string,
  providerName: string,
  models: readonly (readonly [string, string])[],
): ModelOption[] =>
  models.map(([model, modelName]) => ({
    id: `opencode/${providerID}/${model}`,
    provider: "opencode",
    providerName: `opencode via ${providerName}`,
    model: `${providerID}/${model}`,
    modelName,
    family: modelName.split(" ")[0] ?? modelName,
    via: `opencode, through ${providerName}`,
    measured: false,
    available: true,
    reason: null,
  }));

/** As `fixtureModelOptions`, with an Anthropic key's dozen models and two local ones in opencode. */
export const opencodeModelOptions: ModelOptions = {
  options: [
    ...fixtureModelOptions.options,
    ...opencodeOptions("anthropic", "Anthropic", OPENCODE_ANTHROPIC),
    ...opencodeOptions("ollama", "Ollama", OPENCODE_OLLAMA),
  ],
  defaultId: fixtureModelOptions.defaultId,
};

/** Neither Claude Code nor the API can run. */
export const lockedModelOptions: ModelOptions = {
  options: [
    ...options("claude-code", "Claude Code", { reason: NOT_SIGNED_IN }),
    ...options("anthropic-api", "Anthropic API", { reason: NO_API_CREDENTIALS }),
  ],
  defaultId: "claude-code/claude-sonnet-5-5",
};

export const fixtureStatus: StatusResponse = {
  version: "0.0.0-mock",
  hosts: {
    github: { configured: true, user: { id: "lee-park", name: "Lee Park" }, error: null },
    bitbucket: { configured: false, user: null, error: null },
  },
  jira: { configured: true },
  model: fixtureModelOptions,
};
