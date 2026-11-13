import { parseArgs } from "node:util";
import { err, ok, type Result } from "../domain/shared/index.ts";

/** How the model passes reach Claude: "auto" tries Claude Code, then the API. */
export type AiVia = "auto" | "claude-code" | "api";
const AI_VIA: readonly AiVia[] = ["claude-code", "api"];

/**
 * `ai`: null without --ai. `checkout`: the directory given with --checkout, or null for the one
 * megareviewer runs in.
 */
export type Command =
  | {
      readonly kind: "serve";
      readonly port: number;
      readonly open: boolean;
      readonly ai: AiVia | null;
      readonly checkout: string | null;
    }
  | { readonly kind: "doctor"; readonly checkout: string | null }
  | { readonly kind: "version" }
  | { readonly kind: "help" };

export const EXIT = { ok: 0, config: 1, usage: 2 } as const;

export const USAGE = `Usage:
  megareviewer [--port <n>] [--no-open] [--ai] [--ai-via <claude-code|api>] [--checkout <dir>]
                                          Start the review UI (any free port by default);
                                          --ai adds intent, decisions and a guided tour from Claude,
                                          through your signed-in Claude Code, else the Anthropic API;
                                          --ai-via picks one of them and implies --ai;
                                          callers outside the PR come from the git checkout in
                                          <dir>, or else the current directory, when it has the PR
  megareviewer doctor [--checkout <dir>]  Check credentials and setup
  megareviewer --version
  megareviewer --help`;

const MAX_PORT = 65_535;

/** The command, or why the arguments are wrong (exit code 2). */
export const parseCliArgs = (argv: readonly string[]): Result<Command, string> => {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    // parseArgs throws TypeErrors that explain the bad argument.
    if (error instanceof TypeError) return err(error.message);
    throw error;
  }
  const { values, positionals } = parsed;
  if (values.help === true) return ok({ kind: "help" });

  const [command, ...extra] = positionals;
  if (extra.length > 0) return err(`Unexpected argument: ${extra.join(" ")}`);
  const serveFlags =
    values.port !== undefined ||
    values["no-open"] === true ||
    values.ai === true ||
    values["ai-via"] !== undefined;

  const via = values["ai-via"];
  if (via !== undefined && !AI_VIA.some((choice) => choice === via)) {
    return err(`--ai-via must be ${AI_VIA.join(" or ")}`);
  }
  const ai: AiVia | null =
    via === "claude-code" || via === "api" ? via : values.ai === true ? "auto" : null;

  const checkout = values.checkout ?? null;
  if (checkout === "") return err("--checkout needs a directory");

  if (values.version === true) {
    if (command !== undefined || serveFlags || checkout !== null) {
      return err("--version takes no other arguments");
    }
    return ok({ kind: "version" });
  }
  if (command === "doctor") {
    if (serveFlags) return err("doctor takes no options but --checkout");
    return ok({ kind: "doctor", checkout });
  }
  if (command !== undefined) return err(`Unknown command: ${command}`);

  let port = 0;
  if (values.port !== undefined) {
    if (!/^\d+$/.test(values.port) || Number(values.port) > MAX_PORT) {
      return err(`--port must be a number from 0 to ${MAX_PORT}`);
    }
    port = Number(values.port);
  }
  return ok({
    kind: "serve",
    port,
    open: values["no-open"] !== true,
    ai,
    checkout,
  });
};

const parse = (argv: readonly string[]) =>
  parseArgs({
    args: [...argv],
    options: {
      port: { type: "string" },
      "no-open": { type: "boolean" },
      ai: { type: "boolean" },
      "ai-via": { type: "string" },
      checkout: { type: "string" },
      version: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: true,
  });
