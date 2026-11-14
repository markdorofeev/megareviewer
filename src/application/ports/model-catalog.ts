import type { ModelOptionId, ModelOptions } from "../../domain/review/index.ts";
import type { AnalysisModel } from "./analysis-model.ts";

/** Every model option the reviewer's machine can or could run, and the passes on one of them. */
export interface ModelCatalog {
  /**
   * Each provider's options, asked of every provider at once. One that can run is kept; one that
   * can't is asked again next time, so signing in needs no restart.
   */
  options(): Promise<ModelOptions>;
  /**
   * The passes on one option, once `options()` has found its provider able to run it; null for an
   * unknown option or one that can't run.
   */
  model(optionId: ModelOptionId): AnalysisModel | null;
}
