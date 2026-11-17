import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { Logger, PreferenceStore } from "../../application/ports/index.ts";
import {
  Preference,
  type PreferenceId,
  PreferenceProposal,
  type PreferenceScope,
  type RepoRef,
  ReviewSignal,
  type SignalKey,
  Timestamp,
} from "../../domain/review/index.ts";

const ScopeColumns = {
  host: z.string().nullable(),
  owner: z.string().nullable(),
  repo: z.string().nullable(),
};
const PreferenceRow = z.object({
  id: z.string(),
  kind: z.string(),
  text: z.string(),
  ...ScopeColumns,
  source: z.string(),
  enabled: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});
const ProposalRow = z.object({
  id: z.string(),
  kind: z.string(),
  text: z.string(),
  ...ScopeColumns,
  source: z.string(),
  evidence: z.string(),
  status: z.string(),
  created_at: z.string(),
});
const SignalRow = z.object({
  signal_key: z.string(),
  kind: z.string(),
  at: z.string(),
  host: z.string(),
  owner: z.string(),
  repo: z.string(),
  number: z.number(),
  point_kind: z.string().nullable(),
  title: z.string(),
  text: z.string(),
  path: z.string().nullable(),
});
const SwitchRow = z.object({ path: z.string(), enabled: z.number() });
const CountRow = z.object({ count: z.number() });
const SuggestedRow = z.object({ suggested_at: z.string() });

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** A scope's three columns: all NULL for everywhere. */
const scopeColumns = (scope: PreferenceScope): [string | null, string | null, string | null] =>
  scope.kind === "global"
    ? [null, null, null]
    : [scope.repo.host, scope.repo.owner, scope.repo.repo];

const scopeOf = (row: z.infer<z.ZodObject<typeof ScopeColumns>>): unknown =>
  row.host === null
    ? { kind: "global" }
    : { kind: "repo", repo: { host: row.host, owner: row.owner, repo: row.repo } };

/**
 * A PreferenceStore on the analyses' database. Rows are parsed on the way out, and one that no
 * longer parses is logged and left out, as the analyses' are.
 */
export const createSqlitePreferenceStore = (db: DatabaseSync, logger: Logger): PreferenceStore => {
  // julianday, since a host's timestamps and the clock's differ in their fractional seconds.
  const selectPreferences = db.prepare(
    "SELECT * FROM preferences ORDER BY julianday(created_at), id",
  );
  const upsertPreference = db.prepare(
    `INSERT INTO preferences
       (id, kind, text, host, owner, repo, source, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       kind = excluded.kind, text = excluded.text, host = excluded.host, owner = excluded.owner,
       repo = excluded.repo, source = excluded.source, enabled = excluded.enabled,
       created_at = excluded.created_at, updated_at = excluded.updated_at`,
  );
  const deletePreference = db.prepare("DELETE FROM preferences WHERE id = ?");
  const selectProposals = db.prepare(
    "SELECT * FROM preference_proposals ORDER BY julianday(created_at), id",
  );
  const upsertProposal = db.prepare(
    `INSERT INTO preference_proposals
       (id, kind, text, host, owner, repo, source, evidence, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       kind = excluded.kind, text = excluded.text, host = excluded.host, owner = excluded.owner,
       repo = excluded.repo, source = excluded.source, evidence = excluded.evidence,
       status = excluded.status, created_at = excluded.created_at`,
  );
  const upsertSignal = db.prepare(
    `INSERT INTO review_signals
       (signal_key, kind, at, host, owner, repo, number, point_kind, title, text, path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (signal_key) DO UPDATE SET
       kind = excluded.kind, at = excluded.at, host = excluded.host, owner = excluded.owner,
       repo = excluded.repo, number = excluded.number, point_kind = excluded.point_kind,
       title = excluded.title, text = excluded.text, path = excluded.path`,
  );
  const deleteSignal = db.prepare("DELETE FROM review_signals WHERE signal_key = ?");
  const selectSignals = db.prepare(
    "SELECT * FROM review_signals ORDER BY julianday(at) DESC, signal_key LIMIT ?",
  );
  const countSignals = db.prepare("SELECT COUNT(*) AS count FROM review_signals");
  const countSignalsAfter = db.prepare(
    "SELECT COUNT(*) AS count FROM review_signals WHERE julianday(at) > julianday(?)",
  );
  const selectSwitches = db.prepare(
    "SELECT path, enabled FROM guideline_switches WHERE host = ? AND owner = ? AND repo = ?",
  );
  const upsertSwitch = db.prepare(
    `INSERT INTO guideline_switches (host, owner, repo, path, enabled) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (host, owner, repo, path) DO UPDATE SET enabled = excluded.enabled`,
  );
  const selectLastSuggestion = db.prepare(
    "SELECT suggested_at FROM preference_suggestions ORDER BY julianday(suggested_at) DESC LIMIT 1",
  );
  const insertSuggestion = db.prepare(
    "INSERT INTO preference_suggestions (suggested_at) VALUES (?)",
  );

  const parsed = <T>(what: string, id: string, result: z.ZodSafeParseResult<T>): T[] => {
    if (result.success) return [result.data];
    logger.warn(`Ignoring a stored ${what} that no longer parses`, {
      id,
      problem: z.prettifyError(result.error),
    });
    return [];
  };

  return {
    async listPreferences() {
      return selectPreferences.all().flatMap((raw) => {
        const row = PreferenceRow.parse(raw);
        return parsed(
          "preference",
          row.id,
          Preference.safeParse({
            id: row.id,
            kind: row.kind,
            text: row.text,
            scope: scopeOf(row),
            source: row.source,
            enabled: row.enabled === 1,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }),
        );
      });
    },

    async savePreference(preference: Preference) {
      upsertPreference.run(
        preference.id,
        preference.kind,
        preference.text,
        ...scopeColumns(preference.scope),
        preference.source,
        preference.enabled ? 1 : 0,
        preference.createdAt,
        preference.updatedAt,
      );
    },

    async deletePreference(id: PreferenceId) {
      deletePreference.run(id);
    },

    async listProposals() {
      return selectProposals.all().flatMap((raw) => {
        const row = ProposalRow.parse(raw);
        return parsed(
          "preference proposal",
          row.id,
          PreferenceProposal.safeParse({
            id: row.id,
            kind: row.kind,
            text: row.text,
            scope: scopeOf(row),
            source: row.source,
            evidence: parseJson(row.evidence),
            status: row.status,
            createdAt: row.created_at,
          }),
        );
      });
    },

    async saveProposal(proposal: PreferenceProposal) {
      upsertProposal.run(
        proposal.id,
        proposal.kind,
        proposal.text,
        ...scopeColumns(proposal.scope),
        proposal.source,
        JSON.stringify(proposal.evidence),
        proposal.status,
        proposal.createdAt,
      );
    },

    async recordSignal(key: SignalKey, signal: ReviewSignal) {
      const { repo, number } = signal.pullRequest;
      upsertSignal.run(
        key,
        signal.kind,
        signal.at,
        repo.host,
        repo.owner,
        repo.repo,
        number,
        signal.pointKind,
        signal.title,
        signal.text,
        signal.path,
      );
    },

    async removeSignal(key: SignalKey) {
      deleteSignal.run(key);
    },

    async listSignals(limit: number) {
      return selectSignals.all(limit).flatMap((raw) => {
        const row = SignalRow.parse(raw);
        return parsed(
          "review signal",
          row.signal_key,
          ReviewSignal.safeParse({
            kind: row.kind,
            at: row.at,
            pullRequest: {
              repo: { host: row.host, owner: row.owner, repo: row.repo },
              number: row.number,
            },
            pointKind: row.point_kind,
            title: row.title,
            text: row.text,
            path: row.path,
          }),
        );
      });
    },

    async countSignalsSince(at: Timestamp | null) {
      const row = at === null ? countSignals.get() : countSignalsAfter.get(at);
      return CountRow.parse(row).count;
    },

    async getGuidelineSwitches(repo: RepoRef) {
      return new Map(
        selectSwitches.all(repo.host, repo.owner, repo.repo).map((raw) => {
          const row = SwitchRow.parse(raw);
          return [row.path, row.enabled === 1] as const;
        }),
      );
    },

    async setGuidelineSwitch(repo: RepoRef, path: string, enabled: boolean) {
      upsertSwitch.run(repo.host, repo.owner, repo.repo, path, enabled ? 1 : 0);
    },

    async getLastSuggestionAt() {
      const row = selectLastSuggestion.get();
      if (row === undefined) return null;
      const at = Timestamp.safeParse(SuggestedRow.parse(row).suggested_at);
      return at.success ? at.data : null;
    },

    async recordSuggestionAt(at: Timestamp) {
      insertSuggestion.run(at);
    },
  };
};
