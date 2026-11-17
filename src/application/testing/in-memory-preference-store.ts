import {
  inCreationOrder,
  type Preference,
  type PreferenceId,
  type PreferenceProposal,
  type ProposalId,
  type RepoRef,
  type ReviewSignal,
  type SignalKey,
  type Timestamp,
} from "../../domain/review/index.ts";
import type { PreferenceStore } from "../ports/index.ts";

const repoKey = ({ host, owner, repo }: RepoRef): string => `${host}/${owner}/${repo}`;

/** Copies on every read and write, so a test that mutates stored data fails loudly. */
export class InMemoryPreferenceStore implements PreferenceStore {
  private readonly preferences = new Map<PreferenceId, Preference>();
  private readonly proposals = new Map<ProposalId, PreferenceProposal>();
  private readonly signals = new Map<SignalKey, ReviewSignal>();
  private readonly switches = new Map<string, Map<string, boolean>>();
  private lastSuggestionAt: Timestamp | null = null;

  async listPreferences(): Promise<Preference[]> {
    return inCreationOrder(structuredClone([...this.preferences.values()]));
  }

  async savePreference(preference: Preference): Promise<void> {
    this.preferences.set(preference.id, structuredClone(preference));
  }

  async deletePreference(id: PreferenceId): Promise<void> {
    this.preferences.delete(id);
  }

  async listProposals(): Promise<PreferenceProposal[]> {
    return inCreationOrder(structuredClone([...this.proposals.values()]));
  }

  async saveProposal(proposal: PreferenceProposal): Promise<void> {
    this.proposals.set(proposal.id, structuredClone(proposal));
  }

  async recordSignal(key: SignalKey, signal: ReviewSignal): Promise<void> {
    this.signals.set(key, structuredClone(signal));
  }

  async removeSignal(key: SignalKey): Promise<void> {
    this.signals.delete(key);
  }

  async listSignals(limit: number): Promise<ReviewSignal[]> {
    return [...this.signals]
      .sort(
        ([aKey, a], [bKey, b]) =>
          Date.parse(b.at) - Date.parse(a.at) || (aKey < bKey ? -1 : aKey > bKey ? 1 : 0),
      )
      .slice(0, limit)
      .map(([, signal]) => structuredClone(signal));
  }

  async countSignalsSince(at: Timestamp | null): Promise<number> {
    return [...this.signals.values()].filter(
      (signal) => at === null || Date.parse(signal.at) > Date.parse(at),
    ).length;
  }

  async getGuidelineSwitches(repo: RepoRef): Promise<ReadonlyMap<string, boolean>> {
    return new Map(this.switches.get(repoKey(repo)));
  }

  async setGuidelineSwitch(repo: RepoRef, path: string, enabled: boolean): Promise<void> {
    const switches = this.switches.get(repoKey(repo)) ?? new Map<string, boolean>();
    switches.set(path, enabled);
    this.switches.set(repoKey(repo), switches);
  }

  async getLastSuggestionAt(): Promise<Timestamp | null> {
    return this.lastSuggestionAt;
  }

  async recordSuggestionAt(at: Timestamp): Promise<void> {
    this.lastSuggestionAt = at;
  }
}
