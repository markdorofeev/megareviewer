import {
  type ModelOption,
  type ModelOptionId,
  type ModelOptions,
  modelOptionId,
} from "../../domain/review/index.ts";
import type { AnalysisModel, ModelCatalog } from "../ports/index.ts";
import { FakeAnalysisModel } from "./fake-analysis-model.ts";

/** Sonnet 5.5 on Claude Code, available: the catalog's one option unless given others. */
export const fakeModelOption = (overrides: Partial<ModelOption> = {}): ModelOption => {
  const provider = overrides.provider ?? "claude-code";
  const model = overrides.model ?? "claude-sonnet-5-5";
  return {
    id: modelOptionId(provider, model),
    provider,
    providerName: "Claude Code",
    model,
    modelName: "Sonnet 5.5",
    family: "Claude",
    via: "Claude Code, on your Pro plan",
    measured: true,
    available: true,
    reason: null,
    ...overrides,
  };
};

/**
 * Serves `model` for every available option, and the options as given. The default is the first
 * available option on `defaultModel`, else the first available, else the first. `asked` counts
 * calls to `options()`.
 */
export class FakeModelCatalog implements ModelCatalog {
  readonly model: (optionId: ModelOptionId) => AnalysisModel | null;
  asked = 0;
  private current: readonly ModelOption[];
  private readonly defaultModel: string | null;

  constructor(
    options: {
      readonly model?: AnalysisModel;
      readonly options?: readonly ModelOption[];
      readonly defaultModel?: string;
    } = {},
  ) {
    this.defaultModel = options.defaultModel ?? null;
    const model = options.model ?? new FakeAnalysisModel();
    this.current = options.options ?? [fakeModelOption()];
    this.model = (optionId) =>
      this.current.some((option) => option.id === optionId && option.available) ? model : null;
  }

  /** Replaces the options, as signing in or out would. */
  setOptions(options: readonly ModelOption[]): void {
    this.current = options;
  }

  async options(): Promise<ModelOptions> {
    this.asked += 1;
    const available = this.current.filter((option) => option.available);
    const first =
      available.find((option) => option.model === this.defaultModel) ??
      available[0] ??
      this.current[0];
    return { options: this.current, defaultId: first?.id ?? null };
  }
}
