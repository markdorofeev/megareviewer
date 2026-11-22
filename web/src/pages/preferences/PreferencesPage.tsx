import { GlobeIcon, HistoryIcon, SparklesIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { PreferencesView } from "../../../../contracts/index.ts";
import type {
  GuidelinePath,
  ModelOptionId,
  PreferenceId,
  ProposalId,
  RepoRef,
} from "../../../../src/domain/review/index.ts";
import type { Result } from "../../../../src/domain/shared/index.ts";
import { type ApiError, errorMessage, useApi, usePreferences } from "../../api/index.ts";
import { useConnections } from "../../app/connections-context.tsx";
import { navigate, panelOf, preferencesPath, useSearch } from "../../app/router.ts";
import { cn } from "../../lib/utils.ts";
import { DANGER } from "../../review/index.ts";
import { Button } from "../../ui/button.tsx";
import { Skeleton } from "../../ui/skeleton.tsx";
import { HOST_NAMES } from "../picker/PullRequestList.tsx";
import { useModelChoice } from "../review/model-choice.ts";
import { HostIcon } from "./HostIcon.tsx";
import {
  IDLE,
  type ModelActionProps,
  type ModelActionResult,
  type RunPhase,
} from "./ModelAction.tsx";
import {
  EverywherePanel,
  type PanelContext,
  RepositoryPanel,
  SuggestionsPanel,
} from "./Panels.tsx";
import type { RuleFields } from "./PreferenceForm.tsx";
import type { PreferenceActions } from "./PreferenceList.tsx";
import { GLOBAL, repoKey, repoName, scopeKey, scopeOptions } from "./rule.tsx";
import {
  countedPreferences,
  countedProposals,
  type ScopeEntries,
  ScopeList,
  ScopeSelect,
} from "./ScopeNav.tsx";
import type { ProposalActions } from "./Suggested.tsx";
import {
  listName,
  panelFor,
  plural,
  preferencesIn,
  failureReason as reason,
  repositoriesOf,
  SUGGESTIONS,
  whereAdded,
  withGuidelineSwitch,
  withoutPreference,
  withoutProposal,
  withPreference,
  withProposals,
} from "./view.ts";

export const NOTHING_RECORDED =
  "Nothing new to suggest from: megareviewer records the points you dismiss and raise and the comments you post.";

const LoadingPreferences = () => (
  <div
    role="status"
    aria-busy="true"
    aria-label="Loading your preferences"
    className="lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start lg:gap-10"
  >
    <div aria-hidden="true" className="hidden flex-col gap-2 lg:flex">
      {[28, 20, 32, 24].map((width) => (
        <Skeleton
          key={width}
          className="h-[34px] motion-reduce:animate-none"
          style={{ width: `${width * 7}px` }}
        />
      ))}
    </div>
    <div aria-hidden="true" className="flex flex-col gap-3">
      <Skeleton className="h-10 w-full max-w-[440px] motion-reduce:animate-none lg:hidden" />
      <Skeleton className="h-6 w-56 motion-reduce:animate-none" />
      <Skeleton className="h-4 w-80 max-w-full motion-reduce:animate-none" />
      <div className="mt-5 flex flex-col gap-3 rounded-lg border bg-card px-4 py-3">
        {[1, 2].map((row) => (
          <div key={row} className="flex items-center gap-3">
            <Skeleton className="h-[22px] w-24 motion-reduce:animate-none" />
            <Skeleton className="h-4 flex-1 motion-reduce:animate-none" />
          </div>
        ))}
      </div>
    </div>
  </div>
);

/**
 * What the reviewer wants an AI review to look for and to leave out. The scopes are listed on the
 * left, or in a select on a narrow screen: the proposals waiting, everywhere, and each repository.
 * The panel beside them is the one the URL names. Every answer of the API changes the view in
 * place, so nothing is read twice; a model run's state is kept here, so it outlives its panel.
 */
export const PreferencesPage = ({
  now = Date.now,
  startOn,
}: {
  readonly now?: () => number;
  /** A panel to start on, kept in the page rather than the URL, for the design system. */
  readonly startOn?: string;
}) => {
  const { client } = useApi();
  const choice = useModelChoice(useConnections().status?.model ?? null);
  const loaded = usePreferences();
  const [adopted, setAdopted] = useState<PreferencesView | null>(null);
  const [view, setView] = useState<PreferencesView | null>(null);
  if (loaded.preferences !== adopted) {
    setAdopted(loaded.preferences);
    setView(loaded.preferences);
  }
  const [runs, setRuns] = useState<ReadonlyMap<string, RunPhase>>(new Map());
  const [announced, setAnnounced] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const fromUrl = panelOf(useSearch());
  const [kept, setKept] = useState(startOn ?? null);
  const chosenKey = startOn === undefined ? fromUrl : kept;
  // Choosing a scope moves the focus to its panel; Back and a reload leave it where it is.
  const focusPanel = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once the chosen panel is drawn.
  useEffect(() => {
    if (!focusPanel.current) return;
    focusPanel.current = false;
    heading.current?.focus();
  }, [chosenKey]);

  const select = (key: string) => {
    focusPanel.current = true;
    if (startOn !== undefined) setKept(key);
    else navigate(preferencesPath(key === scopeKey(GLOBAL) ? null : key));
  };

  const patch = (change: (view: PreferencesView) => PreferencesView) =>
    setView((previous) => (previous === null ? previous : change(previous)));

  /** Applies an answer to the view, and answers why the request failed, or null. */
  const settle = <T,>(
    result: Result<T, ApiError>,
    change: (view: PreferencesView, value: T) => PreferencesView,
    said: string,
  ): string | null => {
    if (!result.ok) return reason(result.error);
    patch((previous) => change(previous, result.value));
    setAnnounced(said);
    return null;
  };

  const add = async (fields: RuleFields) =>
    settle(await client.addPreference(fields), withPreference, `Added: ${fields.text}`);

  const actions: PreferenceActions = {
    onSwitch: async (id: PreferenceId, enabled: boolean) =>
      settle(
        await client.updatePreference(id, { enabled }),
        withPreference,
        enabled ? "Switched on" : "Switched off",
      ),
    onEdit: async (id: PreferenceId, fields: RuleFields) =>
      settle(await client.updatePreference(id, fields), withPreference, `Saved: ${fields.text}`),
    onDelete: async (id: PreferenceId) =>
      settle(
        await client.deletePreference(id),
        (previous) => withoutPreference(previous, id),
        "Deleted",
      ),
  };

  const proposals: ProposalActions = {
    onAccept: async (id: ProposalId, changes: RuleFields | null) =>
      settle(
        await client.decideProposal(id, { decision: "accept", ...changes }),
        (previous, { preference }) => {
          const without = withoutProposal(previous, id);
          return preference === null ? without : withPreference(without, preference);
        },
        "Added to your preferences",
      ),
    onReject: async (id: ProposalId) =>
      settle(
        await client.decideProposal(id, { decision: "reject" }),
        (previous) => withoutProposal(previous, id),
        "Dismissed",
      ),
  };

  const switchGuideline = async (repo: RepoRef, path: GuidelinePath, enabled: boolean) =>
    settle(
      await client.setGuidelineSwitch({ repo, path, enabled }),
      (previous) => withGuidelineSwitch(previous, repo, path, enabled),
      enabled ? `${path} switched on` : `${path} switched off`,
    );

  const run = (key: string): Pick<ModelActionProps, "phase" | "onPhase" | "choice" | "now"> => ({
    phase: runs.get(key) ?? IDLE,
    onPhase: (phase) => setRuns((previous) => new Map(previous).set(key, phase)),
    choice,
    now,
  });

  const body = () => {
    if (view === null) {
      if (loaded.loading || loaded.error === null) return <LoadingPreferences />;
      return (
        <div
          className={cn(DANGER, "flex flex-wrap items-center justify-between gap-2")}
          role="alert"
        >
          <p>Couldn't read your preferences. {errorMessage(loaded.error)}</p>
          <Button variant="outline" size="sm" onClick={loaded.refresh}>
            Try again
          </Button>
        </div>
      );
    }
    const repositories = repositoriesOf(view);
    const repos = repositories.map((one) => one.repo);
    const scopes = scopeOptions(repos);
    /** Where new proposals went, by the scopes they make, a repository new to the page among them. */
    const where = (added: PreferencesView["proposals"]) =>
      whereAdded(
        added,
        scopeOptions(repositoriesOf(withProposals(view, added)).map((one) => one.repo)),
      );
    const signals = view.signalsSinceSuggestion;

    const suggest: ModelActionProps = {
      ...run("suggest"),
      label: "Suggest from my reviews",
      running: "Reading what you did in reviews…",
      icon: <SparklesIcon aria-hidden="true" />,
      blocked: signals === 0 ? NOTHING_RECORDED : null,
      idle:
        signals === 0
          ? NOTHING_RECORDED
          : `${plural(signals, "action")} recorded since the last suggestions`,
      run: async (optionId: ModelOptionId | undefined): Promise<ModelActionResult> => {
        const result = await client.suggestPreferences(optionId === undefined ? {} : { optionId });
        if (!result.ok) return { ok: false, message: reason(result.error) };
        const { proposals: added, signals: read } = result.value;
        patch((previous) => ({ ...withProposals(previous, added), signalsSinceSuggestion: 0 }));
        const from = `${plural(added.length, "suggestion")} from ${plural(read, "action")}`;
        return {
          ok: true,
          said:
            added.length === 0
              ? `Nothing new to suggest from ${plural(read, "action")}.`
              : `${from}, ${where(added)}.`,
        };
      },
    };

    const importFrom = (repo: RepoRef): ModelActionProps => ({
      ...run(`import ${repoKey(repo)}`),
      label: "Import from my past reviews",
      running: `Reading your comments on ${repoName(repo)}…`,
      icon: <HistoryIcon aria-hidden="true" />,
      what: `Reads your own comments on its recent pull requests on ${HOST_NAMES[repo.host]}, then runs`,
      run: async (optionId: ModelOptionId | undefined): Promise<ModelActionResult> => {
        const result = await client.importPreferences({
          repo,
          ...(optionId === undefined ? {} : { optionId }),
        });
        if (!result.ok) return { ok: false, message: reason(result.error) };
        const { proposals: added, comments, pullRequests } = result.value;
        patch((previous) => withProposals(previous, added));
        if (comments === 0) {
          return {
            ok: true,
            said:
              pullRequests === 0
                ? `Found no pull request of ${repoName(repo)} that you reviewed.`
                : `Found no comment of yours on its last ${plural(pullRequests, "pull request")}.`,
          };
        }
        const read = `Read ${plural(comments, "comment")} from ${plural(pullRequests, "pull request")}`;
        return {
          ok: true,
          said:
            added.length === 0
              ? `${read}: nothing new to suggest.`
              : `${read}: ${plural(added.length, "suggestion")}, ${where(added)}.`,
        };
      },
    });

    const context: PanelContext = {
      view,
      scopes,
      actions,
      proposals,
      add,
      switchGuideline,
      suggest,
      importFrom,
      heading,
      headingId,
    };
    const panel = panelFor(chosenKey, scopes);
    const current = panel.kind === "suggestions" ? SUGGESTIONS : panel.option.key;
    const entries: ScopeEntries = {
      suggestions: {
        key: SUGGESTIONS,
        icon: <SparklesIcon aria-hidden="true" className="size-[15px] shrink-0" />,
        full: "Suggestions",
        name: "Suggestions",
        owner: null,
        count: view.proposals.length,
        counted: countedProposals(view.proposals.length),
        ai: true,
      },
      everywhere: {
        key: scopeKey(GLOBAL),
        icon: <GlobeIcon aria-hidden="true" className="size-[15px] shrink-0" />,
        full: "Everywhere",
        name: "Everywhere",
        owner: null,
        count: preferencesIn(view, GLOBAL).length,
        counted: countedPreferences(preferencesIn(view, GLOBAL).length),
      },
      repositories: scopes.flatMap((option) => {
        if (option.scope.kind !== "repo") return [];
        const count = preferencesIn(view, option.scope).length;
        return [
          {
            key: option.key,
            icon: <HostIcon host={option.scope.repo.host} />,
            full: option.label,
            ...listName(option.scope.repo, repos),
            count,
            counted: countedPreferences(count),
            repo: true,
          },
        ];
      }),
    };
    const shown = (() => {
      if (panel.kind === "suggestions") return <SuggestionsPanel context={context} />;
      const { option } = panel;
      if (option.scope.kind === "global") {
        return <EverywherePanel context={context} option={option} />;
      }
      const repository = repositories.find((one) => repoKey(one.repo) === option.key);
      return repository === undefined ? null : (
        <RepositoryPanel context={context} option={option} repository={repository} />
      );
    })();
    return (
      <div className="lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start lg:gap-10">
        <ScopeList
          entries={entries}
          current={current}
          onSelect={select}
          className="hidden lg:sticky lg:top-4 lg:block"
        />
        <div className="min-w-0">
          <ScopeSelect
            entries={entries}
            current={current}
            onSelect={select}
            className="mb-5 lg:hidden"
          />
          <section aria-labelledby={headingId} data-slot="scope-panel">
            {shown}
          </section>
        </div>
      </div>
    );
  };

  return (
    <div data-slot="preferences-page" className="mx-auto w-full max-w-[1088px] pb-12 lg:pt-5">
      <header className="mb-6 flex flex-col gap-1">
        <h1 className="text-[1.5rem] leading-8 font-semibold tracking-[-0.018em]">Preferences</h1>
        <p className="text-body text-muted-foreground">
          What you want an AI review to look for and to leave out. Used by Request AI review.
        </p>
      </header>
      {body()}
      <span className="sr-only" aria-live="polite">
        {announced}
      </span>
    </div>
  );
};
