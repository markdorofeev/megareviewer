import "./warnings.ts";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "../../package.json" with { type: "json" };
import { type CheckoutInfo, inspectCheckout } from "../adapters/git/index.ts";
import type { Logger } from "../application/ports/index.ts";
import { EXIT, parseCliArgs, USAGE } from "./args.ts";
import { type Composition, compose } from "./compose.ts";
import { type Config, loadConfig } from "./config.ts";
import { createDoctorDeps, formatCheck, repoName, runDoctor } from "./doctor.ts";
import { createLogger } from "./logger.ts";
import { openBrowser } from "./open-browser.ts";
import { serve } from "./serve.ts";

const { version } = packageJson;

/**
 * Bundled, dist/server.js has grammars/ and web/ next to it. From source, the grammars are the
 * tree-sitter adapter's and there is no built UI: Vite serves it.
 */
const locateAssets = (): { grammarsDir: string; staticDir: string | null } => {
  const here = dirname(fileURLToPath(import.meta.url));
  const bundled = join(here, "grammars");
  if (!existsSync(bundled)) {
    return { grammarsDir: join(here, "../adapters/treesitter/grammars"), staticDir: null };
  }
  const web = join(here, "web");
  return { grammarsDir: bundled, staticDir: existsSync(join(web, "index.html")) ? web : null };
};

const printProblems = (problems: readonly string[]): void => {
  console.error("megareviewer can't start:");
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error("\nRun `megareviewer doctor` for details.");
};

const printSummary = (
  config: Config,
  composition: Composition,
  checkout: CheckoutInfo | null,
  url: string,
  ui: boolean,
) => {
  const github = config.github === null ? "not configured" : `token from ${config.github.source}`;
  const bitbucket =
    config.bitbucket === null
      ? "not configured"
      : `as ${config.bitbucket.username} (${config.bitbucket.credential})${config.bitbucket.workspace === null ? "" : `, workspace ${config.bitbucket.workspace}`}`;
  const jira =
    config.jira === null ? "not configured: ticket keys aren't fetched" : config.jira.baseUrl;
  const model = composition.modelEnabled
    ? "on: intent, decisions and the tour's titles come from Claude"
    : "off: start with --ai to add intent, decisions and a guided tour from Claude";
  const repos = checkout?.repos.map(repoName).join(", ") ?? "";
  const local =
    checkout === null
      ? "none: start in a checkout of the PR's repository, or pass --checkout, to show callers outside the PR"
      : `${checkout.root}${repos === "" ? "" : ` (${repos})`}`;
  console.log(`megareviewer ${version}
  GitHub     ${github}
  Bitbucket  ${bitbucket}
  Jira       ${jira}
  Anthropic  ${model}
  Checkout   ${local}
${ui ? "" : "\nNo built UI found, so only the API is served.\n"}
Open ${url}
Press Ctrl+C to stop.`);
};

/** The directory given with --checkout, or the one megareviewer runs in. */
const checkoutDir = (given: string | null): string => resolve(given ?? process.cwd());

const doctor = async (options: { checkout: string | null }): Promise<number> => {
  const { config, problems } = await loadConfig();
  // Adapters' own logs would interleave with the checks; their failures are in the checks.
  const logger = createLogger({ level: "error" });
  const checks = await runDoctor(
    await createDoctorDeps({
      config,
      problems,
      checkoutDir: checkoutDir(options.checkout),
      version,
      logger,
    }),
  );
  for (const check of checks) console.log(formatCheck(check));
  return checks.some((check) => check.status === "fail") ? EXIT.config : EXIT.ok;
};

const stopOnSignal = (stop: () => Promise<void>, logger: Logger): void => {
  let stopping = false;
  const onSignal = (signal: NodeJS.Signals) => {
    // A second Ctrl+C doesn't wait for the first shutdown.
    if (stopping) process.exit(EXIT.config);
    stopping = true;
    logger.info("Shutting down", { signal });
    stop().then(
      () => process.exit(EXIT.ok),
      (error: unknown) => {
        logger.error("Shutdown failed", { error });
        process.exit(EXIT.config);
      },
    );
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
};

/** Resolves to an exit code, or null while the server runs. */
const start = async (options: {
  port: number;
  open: boolean;
  ai: boolean;
  checkout: string | null;
}): Promise<number | null> => {
  const { config, problems } = await loadConfig();
  if (problems.length > 0) {
    printProblems(problems);
    return EXIT.config;
  }
  const logger = createLogger({ level: config.logLevel });
  const assets = locateAssets();
  const dir = checkoutDir(options.checkout);
  const composed = await compose(config, {
    ...assets,
    ai: options.ai,
    checkoutDir: dir,
    version,
    logger,
  });
  if (!composed.ok) {
    printProblems([composed.error]);
    return EXIT.config;
  }
  const composition = composed.value;

  let server: Awaited<ReturnType<typeof serve>>;
  try {
    server = await serve(composition.app, options.port);
  } catch (error) {
    await composition.close();
    printProblems([`Can't listen on port ${options.port}: ${String(error)}`]);
    return EXIT.config;
  }
  stopOnSignal(async () => {
    await server.close();
    await composition.close();
  }, logger);

  const url = `http://127.0.0.1:${server.port}/?token=${composition.sessionToken}`;
  printSummary(config, composition, await inspectCheckout(dir), url, assets.staticDir !== null);
  if (options.open) openBrowser(url, logger);
  return null;
};

const main = async (argv: readonly string[]): Promise<number | null> => {
  const args = parseCliArgs(argv);
  if (!args.ok) {
    console.error(`${args.error}\n\n${USAGE}`);
    return EXIT.usage;
  }
  const command = args.value;
  switch (command.kind) {
    case "help":
      console.log(USAGE);
      return EXIT.ok;
    case "version":
      console.log(version);
      return EXIT.ok;
    case "doctor":
      return doctor(command);
    case "serve":
      return start(command);
  }
};

const code = await main(process.argv.slice(2));
if (code !== null) process.exitCode = code;
