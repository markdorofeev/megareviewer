import { z } from "zod";
import type { ModelBilling } from "../../../domain/review/index.ts";
import type { RunClaude } from "./run-claude.ts";

/** The version the fixtures were recorded on, and the oldest whose flags are known to lock a pass down. */
export const MIN_CLAUDE_CODE_VERSION = "2.1.303";

export type ClaudeCodeStatus =
  | { readonly state: "not-installed" }
  | { readonly state: "signed-out"; readonly version: string }
  | {
      readonly state: "signed-in";
      readonly version: string;
      /** "pro", "max", "team" or "enterprise" on a Claude plan; null on a Console account. */
      readonly plan: string | null;
      readonly billing: ModelBilling;
    }
  | { readonly state: "failed"; readonly message: string };

const AuthStatus = z.object({
  loggedIn: z.boolean(),
  authMethod: z.string().optional(),
  subscriptionType: z.string().nullable().optional(),
});

const VERSION = /^(\d+\.\d+\.\d+)/;

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** Whether Claude Code is installed and signed in, and to what. */
export const claudeCodeStatus = async (run: RunClaude): Promise<ClaudeCodeStatus> => {
  const versionRun = await run(["--version"]);
  if (!versionRun.started) return { state: "not-installed" };
  const version = VERSION.exec(versionRun.lines[0] ?? "")?.[1];
  if (versionRun.code !== 0 || version === undefined) {
    return {
      state: "failed",
      message: `\`claude --version\` failed: ${versionRun.stderr || versionRun.lines.join(" ")}`,
    };
  }

  // It exits 1 when signed out, with the same JSON.
  const authRun = await run(["auth", "status"]);
  const auth = AuthStatus.safeParse(parseJson(authRun.lines.join("\n")));
  if (!auth.success) {
    return {
      state: "failed",
      message: `\`claude auth status\` gave no status: ${authRun.stderr || "no output"}`,
    };
  }
  if (!auth.data.loggedIn) return { state: "signed-out", version };
  const onPlan = auth.data.authMethod === "claude.ai";
  return {
    state: "signed-in",
    version,
    plan: onPlan ? (auth.data.subscriptionType ?? null) : null,
    billing: onPlan ? "plan" : "api",
  };
};

/** -1, 0 or 1 as `a` is older than, the same as or newer than `b`, both "x.y.z". */
export const compareVersions = (a: string, b: string): number => {
  const [left, right] = [a, b].map((version) => version.split(".").map(Number));
  for (let index = 0; index < 3; index++) {
    const difference = (left?.[index] ?? 0) - (right?.[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
};

const PLAN_NAMES: Readonly<Record<string, string>> = {
  pro: "Pro",
  max: "Max",
  team: "Team",
  enterprise: "Enterprise",
};

/** "your Pro plan", or "your Claude plan" for one it doesn't name. */
export const planName = (plan: string | null): string =>
  `your ${plan === null ? "Claude" : (PLAN_NAMES[plan] ?? plan)} plan`;
