import type { ClaudeCodeStatus } from "../src/adapters/claude/index.ts";
import type { ModelBilling } from "../src/domain/review/index.ts";
import { err, ok, type Result } from "../src/domain/shared/index.ts";

export type Via = "api" | "claude-code";

export const parseVia = (via: string): Via | null =>
  via === "api" || via === "claude-code" ? via : null;

/**
 * What a run needs before anything runs: a signed-in Claude Code always, since the judge runs on
 * it, and API credentials only when the passes run on the API.
 */
export const preflight = async (
  via: Via,
  check: {
    readonly claudeCode: () => Promise<ClaudeCodeStatus>;
    readonly hasApiCredentials: () => Promise<boolean>;
  },
): Promise<Result<{ readonly billing: ModelBilling }, string>> => {
  const status = await check.claudeCode();
  if (status.state !== "signed-in") {
    const why = status.state === "failed" ? `failed: ${status.message}` : status.state;
    return err(`The judge runs on Claude Code, which needs to be signed in; it's ${why}.`);
  }
  if (via === "api" && !(await check.hasApiCredentials())) {
    return err(
      "No Anthropic credentials for the passes. Set ANTHROPIC_API_KEY or run `ant auth login`, " +
        "or leave out --via api.",
    );
  }
  return ok({ billing: status.billing });
};
