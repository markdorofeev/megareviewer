import { z } from "zod";
import type { ModelBilling } from "../../../domain/review/index.ts";
import type { RunCodex } from "./run-codex.ts";

/** The version the fixtures were recorded on, and the oldest whose stream is known to show every tool. */
export const MIN_CODEX_VERSION = "0.162.0";

/** A model the reviewer's Codex offers, as `codex debug models` lists it. */
export interface CodexCatalogModel {
  readonly slug: string;
  readonly contextWindow: number | null;
  readonly efforts: readonly string[];
}

export type CodexStatus =
  | { readonly state: "not-installed" }
  | { readonly state: "signed-out"; readonly version: string }
  | {
      readonly state: "signed-in";
      readonly version: string;
      readonly billing: ModelBilling;
      /** The listed models the account has. */
      readonly models: readonly CodexCatalogModel[];
    }
  | { readonly state: "failed"; readonly message: string };

const Catalog = z.object({
  models: z.array(
    z
      .object({
        slug: z.string(),
        visibility: z.string().optional(),
        context_window: z.number().int().positive().nullable().optional(),
        supported_reasoning_levels: z.array(z.object({ effort: z.string() }).loose()).optional(),
      })
      .loose(),
  ),
});

const VERSION = /(\d+\.\d+\.\d+)/;

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** The models Codex lists for picking; hidden ones are Codex's own, such as its reviewer. */
export const parseCatalog = (text: string): readonly CodexCatalogModel[] | null => {
  const catalog = Catalog.safeParse(parseJson(text));
  if (!catalog.success) return null;
  return catalog.data.models
    .filter((model) => model.visibility === "list")
    .map((model) => ({
      slug: model.slug,
      contextWindow: model.context_window ?? null,
      efforts: (model.supported_reasoning_levels ?? []).map((level) => level.effort),
    }));
};

/** Whether Codex is installed and signed in, to what, and the models it offers. */
export const codexStatus = async (run: RunCodex): Promise<CodexStatus> => {
  const versionRun = await run(["--version"]);
  if (!versionRun.started) return { state: "not-installed" };
  const version = VERSION.exec(versionRun.lines[0] ?? "")?.[1];
  if (versionRun.code !== 0 || version === undefined) {
    return {
      state: "failed",
      message: `\`codex --version\` failed: ${versionRun.stderr || versionRun.lines.join(" ")}`,
    };
  }

  // It prints to stderr, and exits 1 when signed out.
  const loginRun = await run(["login", "status"]);
  const said = `${loginRun.stderr}\n${loginRun.lines.join("\n")}`;
  if (/not logged in/i.test(said)) return { state: "signed-out", version };
  if (loginRun.code !== 0 || !/logged in/i.test(said)) {
    return {
      state: "failed",
      message: `\`codex login status\` gave no status: ${said.trim() || "no output"}`,
    };
  }
  const billing: ModelBilling = /chatgpt/i.test(said) ? "plan" : "api";

  const modelsRun = await run(["debug", "models"]);
  const models = modelsRun.code === 0 ? parseCatalog(modelsRun.lines.join("\n")) : null;
  if (models === null) {
    return {
      state: "failed",
      message: `\`codex debug models\` gave no models: ${modelsRun.stderr || "no output"}`,
    };
  }
  return { state: "signed-in", version, billing, models };
};
