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
