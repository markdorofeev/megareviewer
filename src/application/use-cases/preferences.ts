import {
  canEnable,
  GUIDELINE_PATHS,
  type GuidelineFile,
  GuidelinePath,
  guidelineFile,
  MAX_ENABLED_PREFERENCES,
  MAX_EVIDENCE_LINES,
  MAX_PREFERENCE_TEXT,
  type ModelOptionId,
  mergeEvidence,
  type PastComment,
  Preference,
  type PreferenceId,
  type PreferenceKind,
  type PreferenceProposal,
  type PreferenceScope,
  type ProposalId,
  preferenceId,
  proposalId,
  type RepoRef,
  type ReviewSignal,
  sameRule,
} from "../../domain/review/index.ts";
import { err, ok, type Result } from "../../domain/shared/index.ts";
import type { PreferenceSuggester, ProposalDraft } from "../ports/index.ts";
import { chooseOption } from "./analyses.ts";
import type { AppDeps } from "./deps.ts";
import { appError, fromHostError, type UseCaseError } from "./errors.ts";
import { readRootFiles } from "./guidance.ts";
import { mapLimit } from "./text.ts";

/** The analyses whose repositories the page lists, the most recently updated. */
export const LISTED_ANALYSES = 50;
/** The signals of a repository one suggestion reads, the newest. */
export const SUGGESTION_SIGNALS = 200;
/** The pull requests a suggestion reads the reviewer's comments from, the most recently updated. */
export const SUGGESTION_PULL_REQUESTS = 30;
/** Repositories whose guideline files are read at once, each one request to its host at most. */
const GUIDELINE_READS = 6;

export interface RepositoryPreferences {
  readonly repo: RepoRef;
  /** The guideline files the repository has; null when they couldn't be looked for. */
  readonly guidelineFiles: readonly GuidelineFile[] | null;
  /** Why they couldn't be looked for. */
  readonly guidelineNote: string | null;
}

export interface PreferencesView {
  /** In the order they were made. */
  readonly preferences: readonly Preference[];
  /** The ones the reviewer hasn't decided on. */
  readonly proposals: readonly PreferenceProposal[];
  /** The repositories analyzed lately, the latest first, then the others that have a preference. */
  readonly repositories: readonly RepositoryPreferences[];
}

export interface NewPreference {
  readonly kind: PreferenceKind;
  readonly text: string;
  readonly scope: PreferenceScope;
  /** learned: a rule the reviewer saved from a point. Written when left out. */
  readonly source?: "written" | "learned" | undefined;
}

export interface PreferenceChanges {
  readonly kind?: PreferenceKind | undefined;
  readonly text?: string | undefined;
  readonly scope?: PreferenceScope | undefined;
  readonly enabled?: boolean | undefined;
}

/** Accepting a proposal with what the reviewer changed in it, or rejecting it. */
export interface ProposalDecision {
  readonly decision: "accept" | "reject";
  readonly kind?: PreferenceKind | undefined;
  readonly text?: string | undefined;
  readonly scope?: PreferenceScope | undefined;
}

/** What one suggestion proposed, and what it read: signals, and comments of pull requests. */
export interface Suggested {
  readonly proposals: readonly PreferenceProposal[];
  readonly signals: number;
  readonly comments: number;
  readonly pullRequests: number;
}

const repoKey = ({ host, owner, repo }: RepoRef): string => `${host}/${owner}/${repo}`;

const scopeName = (scope: PreferenceScope): string =>
  scope.kind === "global" ? "every repository" : `${scope.repo.owner}/${scope.repo.repo}`;

const tooMany = (scope: PreferenceScope): UseCaseError =>
  appError(
    "bad-request",
    `${MAX_ENABLED_PREFERENCES} preferences are already enabled for ${scopeName(scope)}: switch one off or delete it first`,
  );

/** What the reviewer values: their preferences, the proposals made to them, guideline switches. */
export const createPreferenceUseCases = (deps: AppDeps) => {
  const store = deps.preferences;
  /** The model calls running: a second request for one joins it, so nothing is proposed twice. */
  const proposing = new Map<string, Promise<Result<Suggested, UseCaseError>>>();

  /** A preference of these fields, or why they don't make one. */
  const preferenceOf = (fields: Preference): Result<Preference, UseCaseError> => {
    const preference = Preference.safeParse(fields);
    return preference.success
      ? ok(preference.data)
      : err(
          appError(
            "bad-request",
            `A preference is one sentence of at most ${MAX_PREFERENCE_TEXT} characters`,
          ),
        );
  };

  /** Saves a preference, unless it's enabled and its scope already has as many as it can. */
  const save = async (
    fields: Preference,
    existing: readonly Preference[],
  ): Promise<Result<Preference, UseCaseError>> => {
    const preference = preferenceOf(fields);
    if (!preference.ok) return preference;
    const { enabled, scope, id } = preference.value;
    if (enabled && !canEnable(existing, scope, id)) return err(tooMany(scope));
    await store.savePreference(preference.value);
    return preference;
  };

  const suggesterFor = (optionId: ModelOptionId | undefined) =>
    chooseOption(deps, optionId, (option) => deps.models.suggester(option));

  /**
   * One model call, whose drafts become pending proposals for `repo`, or for every repository
   * where a draft says so. A blank draft, or one that says what a preference or an undecided or
   * rejected proposal already says, is left out.
   */
  const propose = async (
    suggester: PreferenceSuggester,
    read: {
      readonly signals: readonly ReviewSignal[];
      readonly comments: readonly PastComment[];
      readonly repo: RepoRef;
    },
  ): Promise<Result<PreferenceProposal[], UseCaseError>> => {
    const [preferences, existing] = await Promise.all([
      store.listPreferences(),
      store.listProposals(),
    ]);
    const answered = await suggester.suggest({
      ...read,
      preferences,
      rejected: existing.filter((proposal) => proposal.status === "rejected"),
    });
    if (!answered.ok) return err(appError("model-error", answered.error.message));
    const { value: drafts, usage } = answered.value;
    deps.logger.info("Preferences suggested", { drafts: drafts.length, ...usage });

    const said: { kind: PreferenceKind; text: string }[] = [
      ...preferences,
      ...existing.filter((proposal) => proposal.status !== "accepted"),
    ];
    const taken = new Set<string>(existing.map((proposal) => proposal.id));
    const scopeOf = (draft: ProposalDraft): PreferenceScope =>
      draft.scope === "global" ? { kind: "global" } : { kind: "repo", repo: read.repo };
    const createdAt = deps.clock.now();
    const proposals: PreferenceProposal[] = [];
    for (const draft of drafts) {
      const rule = { kind: draft.kind, text: draft.text.trim() };
      if (rule.text === "" || said.some((other) => sameRule(other, rule))) continue;
      said.push(rule);
      const fields = { ...rule, scope: scopeOf(draft), createdAt };
      const proposal: PreferenceProposal = {
        id: proposalId(fields, taken),
        ...fields,
        // What the reviewer did here and their comments on the host are both their reviews.
        source: "learned",
        evidence: draft.evidence
          .map((line) => line.trim())
          .filter((line) => line !== "")
          .slice(0, MAX_EVIDENCE_LINES),
        status: "pending",
      };
      taken.add(proposal.id);
      await store.saveProposal(proposal);
      proposals.push(proposal);
    }
    if (proposals.length < drafts.length) {
      deps.logger.info("Left out proposals that were blank or already said", {
        count: drafts.length - proposals.length,
      });
    }
    return ok(proposals);
  };

  const once = (key: string, run: () => Promise<Result<Suggested, UseCaseError>>) => {
    const running = proposing.get(key);
    if (running !== undefined) return running;
    const started = run().finally(() => proposing.delete(key));
    proposing.set(key, started);
    return started;
  };

  const suggest = async (
    repo: RepoRef,
    optionId: ModelOptionId | undefined,
  ): Promise<Result<Suggested, UseCaseError>> => {
    const chosen = await suggesterFor(optionId);
    if (!chosen.ok) return chosen;
    const history = deps.history[repo.host];
    const [recorded, read] = await Promise.all([
      store.listSignals(SUGGESTION_SIGNALS, repo),
      history === undefined
        ? Promise.resolve(ok({ comments: [], pullRequests: 0 }))
        : history.getReviewerComments(repo, { pullRequests: SUGGESTION_PULL_REQUESTS }),
    ]);
    if (!read.ok) return err(fromHostError(read.error));
    const { pullRequests } = read.value;
    const { signals, comments } = mergeEvidence(recorded, read.value.comments);
    const counts = { signals: signals.length, comments: comments.length, pullRequests };
    if (signals.length === 0 && comments.length === 0) return ok({ proposals: [], ...counts });
    const proposals = await propose(chosen.value.runner, { signals, comments, repo });
    return proposals.ok ? ok({ proposals: proposals.value, ...counts }) : proposals;
  };

  /** A repository's guideline files at the base commit of its latest analysis. */
  const repositoryOf = async (
    repo: RepoRef,
    baseSha: string | null,
  ): Promise<RepositoryPreferences> => {
    const unread = (guidelineNote: string) => ({ repo, guidelineFiles: null, guidelineNote });
    if (baseSha === null) {
      return unread("No pull request of this repository has been analyzed yet");
    }
    const [switches, files] = await Promise.all([
      store.getGuidelineSwitches(repo),
      readRootFiles(deps, repo, baseSha, GUIDELINE_PATHS),
    ]);
    if (!files.ok) return unread(`Couldn't read its guideline files: ${files.error.message}`);
    return {
      repo,
      guidelineFiles: GUIDELINE_PATHS.flatMap((path) => {
        const content = files.value.get(path) ?? null;
        return content === null ? [] : [guidelineFile(path, content, switches)];
      }),
      guidelineNote: null,
    };
  };

  return {
    async getPreferences(): Promise<PreferencesView> {
      const [preferences, proposals, recent] = await Promise.all([
        store.listPreferences(),
        store.listProposals(),
        deps.store.listRecent(LISTED_ANALYSES),
      ]);
      // By repository, with the base commit of its latest analysis that has one.
      const repositories = new Map<string, { repo: RepoRef; baseSha: string | null }>();
      for (const analysis of recent) {
        const { repo } = analysis.key.ref;
        const baseSha = analysis.pullRequest?.baseSha ?? null;
        const known = repositories.get(repoKey(repo));
        if (known === undefined || (known.baseSha === null && baseSha !== null)) {
          repositories.set(repoKey(repo), { repo, baseSha: baseSha ?? known?.baseSha ?? null });
        }
      }
      const others = preferences
        .flatMap(({ scope }) => (scope.kind === "repo" ? [scope.repo] : []))
        .filter((repo) => !repositories.has(repoKey(repo)))
        .sort((a, b) => (repoKey(a) < repoKey(b) ? -1 : repoKey(a) > repoKey(b) ? 1 : 0));
      for (const repo of others) repositories.set(repoKey(repo), { repo, baseSha: null });

      return {
        preferences,
        proposals: proposals.filter((proposal) => proposal.status === "pending"),
        repositories: await mapLimit([...repositories.values()], GUIDELINE_READS, (one) =>
          repositoryOf(one.repo, one.baseSha),
        ),
      };
    },

    async addPreference(input: NewPreference): Promise<Result<Preference, UseCaseError>> {
      const existing = await store.listPreferences();
      const now = deps.clock.now();
      const fields = { kind: input.kind, text: input.text, scope: input.scope, createdAt: now };
      return save(
        {
          id: preferenceId(fields, new Set(existing.map((preference) => preference.id))),
          ...fields,
          source: input.source ?? "written",
          enabled: true,
          updatedAt: now,
        },
        existing,
      );
    },

    async updatePreference(
      id: PreferenceId,
      changes: PreferenceChanges,
    ): Promise<Result<Preference, UseCaseError>> {
      const existing = await store.listPreferences();
      const preference = existing.find((candidate) => candidate.id === id);
      if (preference === undefined) return err(appError("not-found", `No preference ${id}`));
      return save(
        {
          ...preference,
          kind: changes.kind ?? preference.kind,
          text: changes.text ?? preference.text,
          scope: changes.scope ?? preference.scope,
          enabled: changes.enabled ?? preference.enabled,
          updatedAt: deps.clock.now(),
        },
        existing,
      );
    },

    async deletePreference(id: PreferenceId): Promise<Result<null, UseCaseError>> {
      const existing = await store.listPreferences();
      if (!existing.some((preference) => preference.id === id)) {
        return err(appError("not-found", `No preference ${id}`));
      }
      await store.deletePreference(id);
      return ok(null);
    },

    /**
     * Proposes preferences for a repository, in one model call on the chosen option or the
     * default, from what the reviewer did on its pull requests here and their own comments on its
     * recent pull requests, read from its host when megareviewer can, each comment once. Nothing
     * to read is no proposals, and no model call.
     */
    suggestPreferences(
      repo: RepoRef,
      optionId?: ModelOptionId,
    ): Promise<Result<Suggested, UseCaseError>> {
      return once(repoKey(repo), () => suggest(repo, optionId));
    },

    /** Accepting makes a preference of the proposal's source, with what the reviewer changed. */
    async decideProposal(
      id: ProposalId,
      decision: ProposalDecision,
    ): Promise<Result<{ preference: Preference | null }, UseCaseError>> {
      const proposal = (await store.listProposals()).find((candidate) => candidate.id === id);
      if (proposal === undefined) return err(appError("not-found", `No proposal ${id}`));
      if (proposal.status !== "pending") {
        return err(appError("bad-request", `The proposal is already ${proposal.status}`));
      }
      if (decision.decision === "reject") {
        await store.saveProposal({ ...proposal, status: "rejected" });
        return ok({ preference: null });
      }
      const existing = await store.listPreferences();
      const now = deps.clock.now();
      const fields = {
        kind: decision.kind ?? proposal.kind,
        text: decision.text ?? proposal.text,
        scope: decision.scope ?? proposal.scope,
        createdAt: now,
      };
      const saved = await save(
        {
          id: preferenceId(fields, new Set(existing.map((preference) => preference.id))),
          ...fields,
          source: proposal.source,
          enabled: true,
          updatedAt: now,
        },
        existing,
      );
      if (!saved.ok) return saved;
      await store.saveProposal({ ...proposal, status: "accepted" });
      return ok({ preference: saved.value });
    },

    async setGuidelineSwitch(
      repo: RepoRef,
      path: string,
      enabled: boolean,
    ): Promise<Result<null, UseCaseError>> {
      const known = GuidelinePath.safeParse(path);
      if (!known.success) {
        return err(
          appError(
            "bad-request",
            `${path} isn't a guideline file megareviewer reads: ${GUIDELINE_PATHS.join(", ")}`,
          ),
        );
      }
      await store.setGuidelineSwitch(repo, known.data, enabled);
      return ok(null);
    },
  };
};
