import type {
  Preference,
  PreferenceId,
  PreferenceProposal,
  RepoRef,
  ReviewSignal,
  SignalKey,
  Timestamp,
} from "../../domain/review/index.ts";

/**
 * What the reviewer values, on their machine: their preferences, the proposals made to them, the
 * review signals proposals are made from, and their switches for repositories' guideline files.
 * Nothing here is stamped by the store: every time comes in on the value.
 */
export interface PreferenceStore {
  /** In the order they were made, and ones made at the same time in the order first saved. */
  listPreferences(): Promise<Preference[]>;
  /** Upsert by id. */
  savePreference(preference: Preference): Promise<void>;
  deletePreference(id: PreferenceId): Promise<void>;
  /** Whatever their status, in the preferences' order. */
  listProposals(): Promise<PreferenceProposal[]>;
  /** Upsert by id. */
  saveProposal(proposal: PreferenceProposal): Promise<void>;
  /** Upsert by key, so a retry of what made the signal writes it once. */
  recordSignal(key: SignalKey, signal: ReviewSignal): Promise<void>;
  removeSignal(key: SignalKey): Promise<void>;
  /** Newest first. */
  listSignals(limit: number): Promise<ReviewSignal[]>;
  /** How many signals were recorded after `at`; all of them for null. */
  countSignalsSince(at: Timestamp | null): Promise<number>;
  /** The guideline files the reviewer switched on or off for a repository, by path. */
  getGuidelineSwitches(repo: RepoRef): Promise<ReadonlyMap<string, boolean>>;
  setGuidelineSwitch(repo: RepoRef, path: string, enabled: boolean): Promise<void>;
  /** When preferences were last suggested from the signals; null when never. */
  getLastSuggestionAt(): Promise<Timestamp | null>;
  recordSuggestionAt(at: Timestamp): Promise<void>;
}
