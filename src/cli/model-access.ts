import Anthropic from "@anthropic-ai/sdk";
import { loadConfig as loadAnthropicConfig } from "@anthropic-ai/sdk/core/credentials";
import {
  type ClaudeCodeStatus,
  claudeCodeStatus,
  compareVersions,
  createClaudeAnalysisModel,
  createClaudeCodeAnalysisModel,
  MIN_CLAUDE_CODE_VERSION,
  planName,
  type RunClaude,
} from "../adapters/claude/index.ts";
import type { AnalysisModel, Logger, ModelAvailability } from "../application/ports/index.ts";
import type { ModelBilling, ModelError } from "../domain/review/index.ts";
import { err, ok, type Result } from "../domain/shared/index.ts";

export const NO_ANTHROPIC_CREDENTIALS =
  "set ANTHROPIC_API_KEY or run `ant auth login` to use the Anthropic API";

export type ModelTransport =
  | {
      readonly kind: "claude-code";
      readonly version: string;
      readonly plan: string | null;
      readonly billing: ModelBilling;
    }
  | { readonly kind: "api" };

/** What runs the passes, and who pays for it. */
export const describeTransport = (transport: ModelTransport): string =>
  transport.kind === "api"
    ? "Anthropic API, billed to your account"
    : transport.billing === "plan"
      ? `Claude Code, on ${planName(transport.plan)}`
      : "Claude Code, billed to your Anthropic Console account";

/** Why Claude Code can't run the passes, or null when it can. */
export const claudeCodeProblem = (status: ClaudeCodeStatus): string | null => {
  switch (status.state) {
    case "not-installed":
      return "Claude Code isn't installed: install it (https://code.claude.com), then run `claude` and sign in";
    case "signed-out":
      return "Claude Code isn't signed in: run `claude` and sign in";
    case "failed":
      return status.message;
    case "signed-in":
      return compareVersions(status.version, MIN_CLAUDE_CODE_VERSION) < 0
        ? `Claude Code ${status.version} is older than ${MIN_CLAUDE_CODE_VERSION}: run \`claude update\``
        : null;
  }
};

/** Claude Code first when it's installed and signed in, else the API when the SDK finds credentials. */
export const selectTransport = (
  claudeCode: ClaudeCodeStatus,
  apiConfigured: boolean,
): Result<ModelTransport, string> => {
  const problem = claudeCodeProblem(claudeCode);
  if (claudeCode.state === "signed-in" && problem === null) {
    const { version, plan, billing } = claudeCode;
    return ok({ kind: "claude-code", version, plan, billing });
  }
  if (apiConfigured) return ok({ kind: "api" });
  return err(`${problem}; or ${NO_ANTHROPIC_CREDENTIALS}.`);
};

/**
 * Whether the SDK will find credentials: an API key or auth token from the environment, or an
 * `ant auth login` profile. Without them its first request throws, which would be a bug report
 * instead of a fix hint.
 */
export const anthropicConfigured = async (client: Anthropic, logger: Logger): Promise<boolean> => {
  if (client.apiKey !== null || client.authToken !== null) return true;
  try {
    return (await loadAnthropicConfig()) !== null;
  } catch (error) {
    logger.warn("Couldn't read the Anthropic profile", { error });
    return false;
  }
};

export interface ModelAccess {
  /** Runs each pass on the transport `availability` picked, picking it first if it hasn't. */
  readonly model: AnalysisModel;
  /**
   * Whether the passes can run, picking the transport the first time one is available and keeping
   * it. While none is, it checks again each time, so signing in needs no restart.
   */
  availability(): Promise<ModelAvailability>;
}

/** The model passes on whichever of Claude Code or the API can run them, picked when first asked. */
export const createModelAccess = (options: {
  readonly runClaude: RunClaude;
  readonly client?: Anthropic;
  readonly logger: Logger;
  /** For tests: Claude Code's status and the API's credentials, in place of asking them. */
  readonly probe?: () => Promise<{ claudeCode: ClaudeCodeStatus; apiConfigured: boolean }>;
}): ModelAccess => {
  const { runClaude, logger } = options;
  const client = options.client ?? new Anthropic();
  const api = createClaudeAnalysisModel({ client, logger });
  const probe =
    options.probe ??
    (async () => {
      const claudeCode = await claudeCodeStatus(runClaude);
      // The API is only asked about when Claude Code can't run the passes.
      const apiConfigured =
        claudeCodeProblem(claudeCode) !== null && (await anthropicConfigured(client, logger));
      return { claudeCode, apiConfigured };
    });

  interface Chosen {
    readonly transport: ModelTransport;
    readonly model: AnalysisModel;
  }
  let chosen: Chosen | null = null;
  // Shared by callers that ask at once, so Claude Code's status is read once.
  let picking: Promise<Result<Chosen, string>> | null = null;

  const choose = async (): Promise<Result<Chosen, string>> => {
    const { claudeCode, apiConfigured } = await probe();
    const selected = selectTransport(claudeCode, apiConfigured);
    if (!selected.ok) return selected;
    const transport = selected.value;
    const picked: Chosen = {
      transport,
      model:
        transport.kind === "api"
          ? api
          : createClaudeCodeAnalysisModel({ run: runClaude, billing: transport.billing, logger }),
    };
    chosen = picked;
    logger.info("Picked how the model passes run", { via: describeTransport(transport) });
    return ok(picked);
  };

  const pick = (): Promise<Result<Chosen, string>> => {
    if (chosen !== null) return Promise.resolve(ok(chosen));
    const running =
      picking ??
      choose().finally(() => {
        picking = null;
      });
    picking = running;
    return running;
  };

  const onModel = async <T>(
    run: (model: AnalysisModel) => Promise<Result<T, ModelError>>,
  ): Promise<Result<T, ModelError>> => {
    const picked = await pick();
    return picked.ok
      ? run(picked.value.model)
      : err({ kind: "unauthorized", message: `Claude can't run: ${picked.error}` });
  };

  return {
    model: {
      get version() {
        return chosen?.model.version ?? "not picked yet";
      },
      checkSize: (input) => onModel((model) => model.checkSize(input)),
      intent: (input, passOptions) => onModel((model) => model.intent(input, passOptions)),
      risk: (input, intent, passOptions) =>
        onModel((model) => model.risk(input, intent, passOptions)),
      decisions: (input, intent, passOptions) =>
        onModel((model) => model.decisions(input, intent, passOptions)),
      tour: (input, intent, risk, decisions, skeleton, passOptions) =>
        onModel((model) => model.tour(input, intent, risk, decisions, skeleton, passOptions)),
    },
    async availability() {
      const picked = await pick();
      return picked.ok
        ? { available: true, via: describeTransport(picked.value.transport) }
        : { available: false, reason: picked.error };
    },
  };
};
