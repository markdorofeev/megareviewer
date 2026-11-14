import { useCallback } from "react";
import type {
  ModelOption,
  ModelOptionId,
  ModelOptions,
} from "../../../../src/domain/review/index.ts";
import { useStoredState } from "./storage.ts";

export interface ModelChoice {
  /** Every option the server knows, enabled or not, in its order. */
  readonly options: readonly ModelOption[];
  /**
   * The option Request AI review runs: the reviewer's while it can run, else the server's default.
   * Null until the status is in, or when no option is known.
   */
  readonly chosen: ModelOption | null;
  /** Why nothing can run, each provider's reason once; null when something can. */
  readonly locked: string | null;
  readonly choose: (id: ModelOptionId) => void;
}

const parseId = (stored: unknown): string | null | undefined =>
  typeof stored === "string" ? stored : undefined;

/** The options' providers, in their order, each with its options. */
export const byProvider = (
  options: readonly ModelOption[],
): readonly (readonly [ModelOption, readonly ModelOption[]])[] => {
  const groups = new Map<string, ModelOption[]>();
  for (const option of options) {
    const group = groups.get(option.provider) ?? [];
    group.push(option);
    groups.set(option.provider, group);
  }
  return [...groups.values()].flatMap((group) => {
    const [first] = group;
    return first === undefined ? [] : [[first, group] as const];
  });
};

/** Each provider's reason, once, when no option can run. */
export const lockedReason = (options: readonly ModelOption[]): string | null => {
  if (options.length === 0) return "No model is known to megareviewer";
  if (options.some((option) => option.available)) return null;
  const reasons = byProvider(options).map(
    ([first]) => first.reason ?? `${first.providerName} can't run`,
  );
  return reasons.join("; or ");
};

/** The reviewer's choice of model, kept per browser, falling back to the server's default. */
export const useModelChoice = (status: ModelOptions | null): ModelChoice => {
  const [stored, setStored] = useStoredState<string | null>("model-option", null, parseId);
  const options = status?.options ?? [];
  const chosen =
    options.find((option) => option.id === stored && option.available) ??
    options.find((option) => option.id === status?.defaultId) ??
    null;
  const choose = useCallback((id: ModelOptionId) => setStored(() => id), [setStored]);
  return { options, chosen, locked: status === null ? null : lockedReason(options), choose };
};
