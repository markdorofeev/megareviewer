import type {
  ClaudeCodeStatus,
  CodexCatalogModel,
  CodexStatus,
} from "../src/adapters/model/index.ts";
import type { ModelBilling } from "../src/domain/review/index.ts";
import { err, ok, type Result } from "../src/domain/shared/index.ts";

export type Via = "api" | "claude-code" | "codex";

export const parseVia = (via: string): Via | null =>
  via === "api" || via === "claude-code" || via === "codex" ? via : null;

/**
 * What a run needs before anything runs: a signed-in Claude Code always, since the judge runs on
 * it, and API credentials only when the passes run on the API.
 */
export const preflight = async (
  via: Via,
  check: {
    readonly claudeCode: () => Promise<ClaudeCodeStatus>;
    readonly hasApiCredentials: () => Promise<boolean>;
    readonly codex?: () => Promise<CodexStatus>;
  },
): Promise<
  Result<
    {
      readonly billing: ModelBilling;
      /** With --via codex: what the passes bill, and the models Codex offers. */
      readonly codex: {
        readonly billing: ModelBilling;
        readonly models: readonly CodexCatalogModel[];
      } | null;
    },
    string
  >
> => {
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
  if (via !== "codex") return ok({ billing: status.billing, codex: null });
  const codex = await check.codex?.();
  if (codex?.state !== "signed-in") {
    const why =
      codex === undefined ? "not checked" : codex.state === "failed" ? codex.message : codex.state;
    return err(`--via codex runs the passes on Codex, which needs to be signed in; it's ${why}.`);
  }
  return ok({ billing: status.billing, codex: { billing: codex.billing, models: codex.models } });
};
