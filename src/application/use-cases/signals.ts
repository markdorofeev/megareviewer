import type { ReviewSignal, SignalKey } from "../../domain/review/index.ts";
import type { AppDeps } from "./deps.ts";

type SignalDeps = Pick<AppDeps, "preferences" | "logger">;

/**
 * Records what the reviewer did, for proposing preferences from it later. A write that fails is
 * logged and never fails what the reviewer did: the point's state and the comment are what count.
 */
export const recordSignal = async (
  deps: SignalDeps,
  key: SignalKey,
  signal: ReviewSignal,
): Promise<void> => {
  try {
    await deps.preferences.recordSignal(key, signal);
  } catch (error) {
    deps.logger.warn("Couldn't record a review signal", { key, error });
  }
};

export const removeSignal = async (deps: SignalDeps, key: SignalKey): Promise<void> => {
  try {
    await deps.preferences.removeSignal(key);
  } catch (error) {
    deps.logger.warn("Couldn't remove a review signal", { key, error });
  }
};
