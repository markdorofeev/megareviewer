import { z } from "zod";

/** What runs the model passes and decides who pays. */
export const ModelProvider = z.enum(["claude-code", "anthropic-api", "codex"]);
export type ModelProvider = z.infer<typeof ModelProvider>;

const PLANS: Readonly<Record<ModelProvider, string | null>> = {
  "claude-code": "Claude",
  "anthropic-api": null,
  codex: "ChatGPT",
};

/**
 * The plan a provider spends when it runs on one, "ChatGPT" for Codex; stored analyses without an
 * option ran on Claude's.
 */
export const planOf = (option: ModelRunOption | null): string =>
  (option === null ? null : PLANS[option.provider]) ?? "Claude";

/** "claude-code/claude-sonnet-5-5": a model on a provider. */
export const ModelOptionId = z.string().regex(/^[a-z0-9-]+\/[A-Za-z0-9._:/-]+$/);
export type ModelOptionId = z.infer<typeof ModelOptionId>;

/** The provider and model a model run used, with the names the page shows. */
export const ModelRunOption = z
  .object({
    provider: ModelProvider,
    /** "Claude Code" */
    providerName: z.string().min(1),
    /** "claude-sonnet-5-5" */
    model: z.string().min(1),
    /** "Sonnet 5.5" */
    modelName: z.string().min(1),
    /** Who made the model, "Claude": the page names a run's points by it. */
    family: z.string().min(1),
  })
  .readonly();
export type ModelRunOption = z.infer<typeof ModelRunOption>;

/** An option the reviewer can choose when its provider can run it, with why when it can't. */
export const ModelOption = ModelRunOption.unwrap()
  .extend({
    id: ModelOptionId,
    /** What runs it and who pays: "Claude Code, on your Pro plan". */
    via: z.string().min(1),
    /** The evals have run on it, with a report under evals/reports/. */
    measured: z.boolean(),
    available: z.boolean(),
    /** Why it can't run, and the fix; null when it can. */
    reason: z.string().nullable(),
  })
  .readonly();
export type ModelOption = z.infer<typeof ModelOption>;

/** Every option megareviewer knows, grouped by provider, and the one a run without a choice uses. */
export const ModelOptions = z
  .object({
    options: z.array(ModelOption).readonly(),
    /**
     * The first available provider's default model; with none available, the first provider's,
     * so the page can say why it can't run. Null only when there are no options at all.
     */
    defaultId: ModelOptionId.nullable(),
  })
  .readonly();
export type ModelOptions = z.infer<typeof ModelOptions>;

export const modelOptionId = (provider: ModelProvider, model: string): ModelOptionId =>
  `${provider}/${model}`;

/** The family a run's points are named by: stored analyses without an option all ran on Claude. */
export const modelFamily = (option: ModelRunOption | null): string => option?.family ?? "Claude";

/** The option's run fields, for recording on an analysis. */
export const runOptionOf = ({
  provider,
  providerName,
  model,
  modelName,
  family,
}: ModelRunOption): ModelRunOption => ({ provider, providerName, model, modelName, family });
