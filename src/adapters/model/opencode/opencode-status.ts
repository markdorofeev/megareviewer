import { z } from "zod";
import { compareVersions, type RunCommand } from "../shared/run-command.ts";
import { describeHttpError, type OpencodeClient } from "./opencode-client.ts";

/** The version the spike measured: the first whose HTTP API megareviewer speaks. */
export const MIN_OPENCODE_VERSION = "2.3.0";

/** A model one of the reviewer's opencode providers offers. */
export interface OpencodeModel {
  readonly providerID: string;
  /** "Anthropic" */
  readonly providerName: string;
  readonly id: string;
  /** "Claude Haiku 5.5" */
  readonly name: string;
  /** Its efforts, "low" to "max", or none. */
  readonly variants: readonly string[];
  readonly contextTokens: number | null;
  /** Whether opencode's catalog prices it, so the cost it reports means something. */
  readonly priced: boolean;
}

export type OpencodeStatus =
  | { readonly state: "not-installed" }
  | { readonly state: "failed"; readonly message: string }
  /** Its server's API is older than the one megareviewer speaks, so it isn't started. */
  | { readonly state: "outdated"; readonly version: string }
  | {
      readonly state: "running";
      readonly version: string;
      /** Empty when no provider is connected. */
      readonly models: readonly OpencodeModel[];
      /** opencode's default model, as "provider/model", when it has one. */
      readonly defaultModel: string | null;
    };

const ModelList = z.object({
  data: z.array(
    z
      .object({
        id: z.string(),
        providerID: z.string(),
        name: z.string(),
        type: z.string().optional(),
        status: z.string().optional(),
        enabled: z.boolean().optional(),
        variants: z.array(z.object({ id: z.string() }).loose()).optional(),
        cost: z.array(z.unknown()).optional(),
        limit: z.object({ context: z.number().int().positive().optional() }).loose().optional(),
      })
      .loose(),
  ),
});

const ProviderList = z.object({
  data: z.array(z.object({ id: z.string(), name: z.string() }).loose()),
});

const DefaultModel = z.object({
  data: z.object({ id: z.string(), providerID: z.string() }).loose().nullable(),
});

const VERSION = /(\d+\.\d+\.\d+)/;

/** Chat models opencode can run now, with their providers' names. */
export const parseModels = (models: unknown, providers: unknown): OpencodeModel[] | null => {
  const listed = ModelList.safeParse(models);
  const named = ProviderList.safeParse(providers);
  if (!listed.success) return null;
  const names = new Map((named.success ? named.data.data : []).map((p) => [p.id, p.name]));
  return listed.data.data
    .filter(
      (model) =>
        (model.type ?? "chat") === "chat" &&
        model.enabled !== false &&
        model.status !== "deprecated",
    )
    .map((model) => ({
      providerID: model.providerID,
      providerName: names.get(model.providerID) ?? model.providerID,
      id: model.id,
      name: model.name,
      variants: (model.variants ?? []).map((variant) => variant.id),
      contextTokens: model.limit?.context ?? null,
      priced: (model.cost ?? []).length > 0,
    }));
};

/** Whether opencode is installed, which version, and the models its server offers. */
export const opencodeStatus = async (
  run: RunCommand,
  client: OpencodeClient,
): Promise<OpencodeStatus> => {
  const versionRun = await run(["--version"]);
  if (!versionRun.started) return { state: "not-installed" };
  const version = VERSION.exec(versionRun.lines[0] ?? "")?.[1];
  if (versionRun.code !== 0 || version === undefined) {
    return {
      state: "failed",
      message: `\`opencode --version\` failed: ${versionRun.stderr || versionRun.lines.join(" ")}`,
    };
  }

  if (compareVersions(version, MIN_OPENCODE_VERSION) < 0) return { state: "outdated", version };

  const [models, providers, fallback] = await Promise.all([
    client.request("GET", "/api/model"),
    client.request("GET", "/api/provider"),
    client.request("GET", "/api/model/default"),
  ]);
  if (!models.ok) return { state: "failed", message: describeHttpError(models.error) };
  const parsed = parseModels(models.value, providers.ok ? providers.value : null);
  if (parsed === null) {
    return {
      state: "failed",
      message: "opencode's server listed its models in a shape megareviewer doesn't know",
    };
  }
  const chosen = fallback.ok ? DefaultModel.safeParse(fallback.value) : null;
  const defaultModel =
    chosen?.success && chosen.data.data !== null
      ? `${chosen.data.data.providerID}/${chosen.data.data.id}`
      : null;
  return { state: "running", version, models: parsed, defaultModel };
};
