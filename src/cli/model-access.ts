import Anthropic from "@anthropic-ai/sdk";
import { loadConfig as loadAnthropicConfig } from "@anthropic-ai/sdk/core/credentials";
import {
  CLAUDE_MODELS,
  type ClaudeCodeStatus,
  CODEX_MODELS,
  type CodexCatalogModel,
  type CodexStatus,
  claudeCodeStatus,
  codexStatus,
  compareVersions,
  createClaudeAnalysisModel,
  createClaudeCodeAnalysisModel,
  createCodexAnalysisModel,
  createOpencodeAnalysisModel,
  createOpencodeClient,
  createOpencodeServer,
  createRunCodex,
  createRunOpencode,
  DEFAULT_CODEX_MODEL,
  DEFAULT_MODEL,
  MIN_CLAUDE_CODE_VERSION,
  MIN_CODEX_VERSION,
  MIN_OPENCODE_VERSION,
  type OpencodeModel,
  type OpencodeServer,
  type OpencodeStatus,
  opencodeStatus,
  planName,
  type RunClaude,
  type RunCodex,
  type RunOpencode,
} from "../adapters/model/index.ts";
import type { AnalysisModel, Logger, ModelCatalog } from "../application/ports/index.ts";
import {
  type ModelBilling,
  type ModelOption,
  type ModelOptionId,
  ModelOptionId as ModelOptionIdSchema,
  type ModelOptions,
  type ModelProvider,
  modelOptionId,
} from "../domain/review/index.ts";

export const NO_ANTHROPIC_CREDENTIALS =
  "set ANTHROPIC_API_KEY or run `ant auth login` to use the Anthropic API";

/** How long a provider has to say whether it can run, so a hung command can't hold the page. */
export const PROBE_TIMEOUT_MS = 5_000;

/** What runs the passes, and who pays for it. */
export const describeClaudeCode = (claudeCode: {
  readonly plan: string | null;
  readonly billing: ModelBilling;
}): string =>
  claudeCode.billing === "plan"
    ? `Claude Code, on ${planName(claudeCode.plan)}`
    : "Claude Code, billed to your Anthropic Console account";

export const API_VIA = "Anthropic API, billed to your account";

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

/** What runs the passes through Codex, and who pays. */
export const describeCodex = (billing: ModelBilling): string =>
  billing === "plan" ? "Codex, on your ChatGPT plan" : "Codex, billed to your OpenAI account";

/** Why Codex can't run the passes, or null when it can. */
export const codexProblem = (status: CodexStatus): string | null => {
  switch (status.state) {
    case "not-installed":
      return "Codex isn't installed: install the Codex CLI, then run `codex login`";
    case "signed-out":
      return "Codex isn't signed in: run `codex login`";
    case "failed":
      return status.message;
    case "signed-in":
      return compareVersions(status.version, MIN_CODEX_VERSION) < 0
        ? `Codex ${status.version} is older than ${MIN_CODEX_VERSION}: run \`codex update\``
        : null;
  }
};

/** What runs a model through opencode: the reviewer's own provider, at its prices. */
export const describeOpencode = (providerName: string): string => `opencode, on ${providerName}`;

export const OPENCODE_NOT_INSTALLED =
  "opencode isn't installed: install it (https://opencode.ai), then connect a provider with `opencode auth login`";

/** Why opencode can't run the passes, or null when it can. */
export const opencodeProblem = (status: OpencodeStatus): string | null => {
  switch (status.state) {
    case "not-installed":
      return OPENCODE_NOT_INSTALLED;
    case "failed":
      return status.message;
    case "outdated":
      return `opencode ${status.version} is older than ${MIN_OPENCODE_VERSION}: run \`opencode upgrade\``;
    case "running":
      return status.models.length === 0
        ? "opencode has no provider connected: run `opencode auth login`"
        : null;
  }
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

/** Whether a provider can run the passes: what runs them and who pays, or why it can't. */
export type ProviderStatus =
  | { readonly available: true; readonly via: string; readonly billing: ModelBilling }
  | { readonly available: false; readonly reason: string };

/** A model a provider lists. */
export interface ProviderModel {
  readonly id: string;
  readonly name: string;
  /** Who made it: the page names a run's points by it. */
  readonly family: string;
  /** What runs it and who pays, when that differs between a provider's models. */
  readonly via?: string;
  /** The name a run is recorded under, when the provider runs it through another. */
  readonly providerName?: string;
  /** False for a model the evals haven't run on. Default: true. */
  readonly measured?: boolean;
}

export interface CatalogProvider {
  readonly id: ModelProvider;
  readonly name: string;
  /** Its default model, when it's the first that can run. */
  defaultModel(status: ProviderStatus): string;
  /** The models it lists: all of megareviewer's, or the ones its status says it can run. */
  models(status: ProviderStatus): readonly ProviderModel[];
}

interface Provider extends CatalogProvider {
  probe(): Promise<ProviderStatus>;
  model(model: string, status: ProviderStatus & { available: true }): AnalysisModel;
}

/** A provider's answer, or that it didn't give one in time. Never rejects. */
const probeWithin = async (provider: Provider, timeoutMs: number): Promise<ProviderStatus> => {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<ProviderStatus>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          available: false,
          reason: `${provider.name} didn't say whether it can run within ${timeoutMs / 1000} seconds`,
        }),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([
      provider.probe().catch(
        (error: unknown): ProviderStatus => ({
          available: false,
          reason: `${provider.name} couldn't be checked: ${String(error)}`,
        }),
      ),
      timedOut,
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const NOT_CHECKED: ProviderStatus = { available: false, reason: "not checked" };

/** Every listed model on every provider, in the providers' order, cheapest model first. */
export const catalogOptions = (
  providers: readonly CatalogProvider[],
  statuses: readonly ProviderStatus[],
): ModelOptions => {
  const options = providers.flatMap((provider, index): ModelOption[] => {
    const status = statuses[index] ?? NOT_CHECKED;
    return provider.models(status).map((model) => ({
      id: modelOptionId(provider.id, model.id),
      provider: provider.id,
      providerName: model.providerName ?? provider.name,
      model: model.id,
      modelName: model.name,
      family: model.family,
      via: status.available ? (model.via ?? status.via) : provider.name,
      measured: model.measured ?? true,
      available: status.available,
      reason: status.available ? null : status.reason,
    }));
  });
  const firstAvailable = providers.find((_, index) => statuses[index]?.available === true);
  const provider = firstAvailable ?? providers[0];
  return {
    options,
    defaultId:
      provider === undefined
        ? null
        : modelOptionId(
            provider.id,
            provider.defaultModel(statuses[providers.indexOf(provider)] ?? NOT_CHECKED),
          ),
  };
};

const CLAUDE: readonly ProviderModel[] = CLAUDE_MODELS.map(({ id, name }) => ({
  id,
  name,
  family: "Claude",
}));

/**
 * Codex's listed models: the ones megareviewer measured that the reviewer's account offers, or
 * all of them while Codex can't say.
 */
export const codexModels = (
  catalog: readonly CodexCatalogModel[] | null,
): readonly ProviderModel[] =>
  CODEX_MODELS.filter(
    (model) => catalog === null || catalog.some((offered) => offered.slug === model.id),
  ).map(({ id, name }) => ({ id, name, family: "GPT" }));

/** The one row opencode's group has while it can't run, which the menu disables with the fix. */
export const OPENCODE_PLACEHOLDER: ProviderModel = {
  id: "models",
  name: "Your opencode models",
  family: "opencode",
  measured: false,
};

/** "Claude Haiku 5.5" is a Claude, "GPT-6 Luna" a GPT: the first word of the name. */
const familyOf = (name: string): string => name.split(/[\s-]/)[0] || name;

/**
 * The models the reviewer's opencode offers, as "provider/model", each run through the provider
 * it's on. None is measured: they're whatever the reviewer connected.
 */
export const opencodeModels = (models: readonly OpencodeModel[]): readonly ProviderModel[] =>
  models.flatMap((model) => {
    const id = `${model.providerID}/${model.id}`;
    // An ID the option ID can't carry isn't offered.
    if (!ModelOptionIdSchema.safeParse(modelOptionId("opencode", id)).success) return [];
    return [
      {
        id,
        name: model.name,
        family: familyOf(model.name),
        via: describeOpencode(model.providerName),
        providerName: `opencode on ${model.providerName}`,
        measured: false,
      },
    ];
  });

export interface ModelCatalogOptions {
  readonly runClaude: RunClaude;
  /** Default: the `codex` on the PATH. */
  readonly runCodex?: RunCodex;
  /** Default: the `opencode` on the PATH, and a server of its own, stopped with megareviewer. */
  readonly runOpencode?: RunOpencode;
  readonly opencodeServer?: OpencodeServer;
  readonly client?: Anthropic;
  readonly logger: Logger;
  readonly timeoutMs?: number;
  /** For tests: Claude Code's status and the API's credentials, in place of asking them. */
  readonly probe?: {
    readonly claudeCode: () => Promise<ClaudeCodeStatus>;
    readonly apiConfigured: () => Promise<boolean>;
    readonly codex: () => Promise<CodexStatus>;
    readonly opencode: () => Promise<OpencodeStatus>;
  };
}

/**
 * Claude's models on Claude Code, then on the Anthropic API, then OpenAI's on Codex, then the
 * models the reviewer's opencode offers. All are asked
 * at once; one that can run is kept for the process, and one that can't is asked again on the
 * next request.
 */
export const createModelCatalog = (options: ModelCatalogOptions): ModelCatalog => {
  const { runClaude, logger } = options;
  const runCodex = options.runCodex ?? createRunCodex();
  const client = options.client ?? new Anthropic();
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const opencodeClient = createOpencodeClient(options.opencodeServer ?? createOpencodeServer());
  const probe = options.probe ?? {
    claudeCode: () => claudeCodeStatus(runClaude),
    apiConfigured: () => anthropicConfigured(client, logger),
    codex: () => codexStatus(runCodex),
    opencode: () => opencodeStatus(options.runOpencode ?? createRunOpencode(), opencodeClient),
  };
  // What Codex last said it offers: the models it lists, their context windows and efforts.
  let codexCatalog: readonly CodexCatalogModel[] | null = null;
  // What opencode's server last listed, and its default model.
  let opencodeOffered: readonly OpencodeModel[] = [];
  let opencodeDefault: string | null = null;

  const providers: readonly Provider[] = [
    {
      id: "claude-code",
      name: "Claude Code",
      defaultModel: () => DEFAULT_MODEL,
      models: () => CLAUDE,
      async probe() {
        const status = await probe.claudeCode();
        const problem = claudeCodeProblem(status);
        if (status.state !== "signed-in" || problem !== null) {
          return { available: false, reason: problem ?? "Claude Code can't run" };
        }
        return { available: true, via: describeClaudeCode(status), billing: status.billing };
      },
      model: (model, status) =>
        createClaudeCodeAnalysisModel({ run: runClaude, billing: status.billing, model, logger }),
    },
    {
      id: "anthropic-api",
      name: "Anthropic API",
      defaultModel: () => DEFAULT_MODEL,
      models: () => CLAUDE,
      async probe() {
        return (await probe.apiConfigured())
          ? { available: true, via: API_VIA, billing: "api" }
          : {
              available: false,
              reason: `No Anthropic API credentials: ${NO_ANTHROPIC_CREDENTIALS}`,
            };
      },
      model: (model) => createClaudeAnalysisModel({ client, logger, model }),
    },
    {
      id: "codex",
      name: "Codex",
      defaultModel: () => DEFAULT_CODEX_MODEL,
      models: (status) => codexModels(status.available ? codexCatalog : null),
      async probe() {
        const status = await probe.codex();
        const problem = codexProblem(status);
        if (status.state !== "signed-in" || problem !== null) {
          return { available: false, reason: problem ?? "Codex can't run" };
        }
        codexCatalog = status.models;
        return { available: true, via: describeCodex(status.billing), billing: status.billing };
      },
      model: (model, status) => {
        const offered = codexCatalog?.find((candidate) => candidate.slug === model);
        return createCodexAnalysisModel({
          run: runCodex,
          billing: status.billing,
          model,
          contextWindow: offered?.contextWindow ?? null,
          efforts: offered?.efforts ?? [],
          logger,
        });
      },
    },
    {
      id: "opencode",
      name: "opencode",
      defaultModel: (status) =>
        (status.available ? (opencodeDefault ?? opencodeModels(opencodeOffered)[0]?.id) : null) ??
        OPENCODE_PLACEHOLDER.id,
      models: (status) =>
        status.available ? opencodeModels(opencodeOffered) : [OPENCODE_PLACEHOLDER],
      async probe() {
        const status = await probe.opencode();
        const problem = opencodeProblem(status);
        if (status.state !== "running" || problem !== null) {
          return { available: false, reason: problem ?? "opencode can't run" };
        }
        opencodeOffered = status.models;
        const listed = opencodeModels(status.models);
        opencodeDefault = listed.some((model) => model.id === status.defaultModel)
          ? status.defaultModel
          : null;
        return { available: true, via: "opencode", billing: "api" };
      },
      model: (model) => {
        const offered = opencodeOffered.find(
          (candidate) => `${candidate.providerID}/${candidate.id}` === model,
        );
        if (offered === undefined) throw new Error(`opencode doesn't offer ${model}`);
        return createOpencodeAnalysisModel({
          client: opencodeClient,
          providerID: offered.providerID,
          model: offered.id,
          variants: offered.variants,
          contextTokens: offered.contextTokens,
          priced: offered.priced,
          logger,
        });
      },
    },
  ];

  const kept = new Map<ModelProvider, ProviderStatus & { available: true }>();
  // Shared by requests that ask at once, so each command runs once.
  const asking = new Map<ModelProvider, Promise<ProviderStatus>>();
  const models = new Map<ModelOptionId, AnalysisModel>();

  const statusOf = (provider: Provider): Promise<ProviderStatus> => {
    const known = kept.get(provider.id);
    if (known !== undefined) return Promise.resolve(known);
    const running =
      asking.get(provider.id) ??
      probeWithin(provider, timeoutMs).then((status) => {
        asking.delete(provider.id);
        if (status.available) {
          kept.set(provider.id, status);
          logger.info("A model provider can run the passes", { via: status.via });
        }
        return status;
      });
    asking.set(provider.id, running);
    return running;
  };

  return {
    async options() {
      return catalogOptions(providers, await Promise.all(providers.map(statusOf)));
    },

    model(optionId) {
      const cached = models.get(optionId);
      if (cached !== undefined) return cached;
      const [providerId, ...rest] = optionId.split("/");
      const modelId = rest.join("/");
      const provider = providers.find((candidate) => candidate.id === providerId);
      const status = provider === undefined ? undefined : kept.get(provider.id);
      if (provider === undefined || status === undefined) return null;
      if (!provider.models(status).some((model) => model.id === modelId)) return null;
      const model = provider.model(modelId, status);
      models.set(optionId, model);
      return model;
    },
  };
};

/** The default option and who pays, or each provider's reason when none can run. */
export const modelSummary = ({ options, defaultId }: ModelOptions): string => {
  const chosen = options.find((option) => option.id === defaultId);
  if (chosen?.available === true) {
    const others = options.filter((option) => option.available).length - 1;
    return `${chosen.modelName} through ${chosen.via}${others > 0 ? `, or ${others} more in Request AI review's menu` : ""}`;
  }
  const reasons = [...new Set(options.flatMap((option) => option.reason ?? []))];
  return `unavailable: ${reasons.join("; or ") || "no model is known"}`;
};
