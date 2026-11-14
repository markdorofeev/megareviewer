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
  /** The server's default, which a long group shows before its filter. */
  readonly defaultId: ModelOptionId | null;
  /** Why nothing can run, each provider's reason once; null when something can. */
  readonly locked: string | null;
  readonly choose: (id: ModelOptionId) => void;
}

const parseId = (stored: unknown): string | null | undefined =>
  typeof stored === "string" ? stored : undefined;

/**
 * The options grouped by what runs them and who pays, in their order, each group with its options:
 * a provider's, or, for opencode, each provider behind it. A provider that can't run is one group.
 */
export const byProvider = (
  options: readonly ModelOption[],
): readonly (readonly [ModelOption, readonly ModelOption[]])[] => {
  const groups = new Map<string, ModelOption[]>();
  for (const option of options) {
    const key = option.available ? `${option.provider} ${option.via}` : option.provider;
    const group = groups.get(key) ?? [];
    group.push(option);
    groups.set(key, group);
  }
  return [...groups.values()].flatMap((group) => {
    const [first] = group;
    return first === undefined ? [] : [[first, group] as const];
  });
};

/** More options than this in a group, and the rest are behind a filter. */
export const LONG_GROUP = 6;

/**
 * What a group shows before its filter: all of a short group; of a long one, the chosen option and
 * the default, else its first.
 */
export const pinnedOf = (
  group: readonly ModelOption[],
  chosen: ModelOption | null,
  defaultId: ModelOptionId | null,
): readonly ModelOption[] => {
  if (group.length <= LONG_GROUP) return group;
  const pinned = group.filter((option) => option.id === chosen?.id || option.id === defaultId);
  return pinned.length > 0 ? pinned : group.slice(0, 1);
};

/** A long group's other options whose name or ID has every word of the query. */
export const matching = (
  group: readonly ModelOption[],
  pinned: readonly ModelOption[],
  query: string,
): readonly ModelOption[] => {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "");
  if (words.length === 0) return [];
  return group.filter(
    (option) =>
      !pinned.includes(option) &&
      words.every((word) => `${option.modelName} ${option.model}`.toLowerCase().includes(word)),
  );
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
  return {
    options,
    chosen,
    defaultId: status?.defaultId ?? null,
    locked: status === null ? null : lockedReason(options),
    choose,
  };
};
