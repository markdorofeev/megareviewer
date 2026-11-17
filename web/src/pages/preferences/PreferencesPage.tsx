import { HistoryIcon, SparklesIcon } from "lucide-react";
import { useRef, useState } from "react";
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
import { cn } from "../../lib/utils.ts";
import { DANGER } from "../../review/index.ts";
import { Badge } from "../../ui/badge.tsx";
import { Button } from "../../ui/button.tsx";
import { Skeleton } from "../../ui/skeleton.tsx";
import { HOST_NAMES } from "../picker/PullRequestList.tsx";
import { useModelChoice } from "../review/model-choice.ts";
import { GuidelineFiles } from "./GuidelineFiles.tsx";
import { ModelAction, type ModelActionResult } from "./ModelAction.tsx";
import { PreferenceForm, type RuleFields } from "./PreferenceForm.tsx";
import type { PreferenceActions } from "./PreferenceList.tsx";
import { GLOBAL, KindChip, repoKey, repoName, scopeOptions } from "./rule.tsx";
import { ScopeSection } from "./ScopeSection.tsx";
import { type ProposalActions, Suggested } from "./Suggested.tsx";
import {
  plural,
  preferencesIn,
  failureReason as reason,
  repositoriesOf,
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
    className="flex flex-col gap-4"
  >
    <Skeleton className="h-7 w-56 motion-reduce:animate-none" />
    {[3, 2].map((rows) => (
      <div key={rows} className="flex flex-col overflow-hidden rounded-xl border bg-card">
        <div className="flex h-11 items-center border-b px-4">
          <Skeleton className="h-4 w-32 motion-reduce:animate-none" />
        </div>
        <ul aria-hidden="true" className="flex flex-col gap-3 px-4 py-3">
          {Array.from({ length: rows }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have nothing else.
            <li key={index} className="flex items-center gap-3">
              <Skeleton className="h-5 w-20 rounded-full motion-reduce:animate-none" />
              <Skeleton className="h-4 flex-1 motion-reduce:animate-none" />
              <Skeleton className="h-4 w-12 motion-reduce:animate-none" />
            </li>
          ))}
        </ul>
      </div>
    ))}
  </div>
);

/** What a preference is, where there's none yet. */
const WhatItIs = () => (
  <p className="text-muted-foreground">
    A preference is one rule for AI reviews: something to look for, or something not to flag. For
    example <KindChip kind="look-for" className="align-middle" /> “Tenant isolation: every query
    filters by tenant ID”, or <KindChip kind="dont-flag" className="align-middle" /> “Naming”.
  </p>
);

/**
 * What the reviewer wants an AI review to look for and to leave out: their preferences for
 * everywhere and for each repository, the proposals waiting for them, and each repository's
 * guideline files. Every answer of the API changes the view in place, so nothing is read twice.
 */
export const PreferencesPage = ({ now = Date.now }: { readonly now?: () => number }) => {
  const { client } = useApi();
  const choice = useModelChoice(useConnections().status?.model ?? null);
  const loaded = usePreferences();
  const [adopted, setAdopted] = useState<PreferencesView | null>(null);
  const [view, setView] = useState<PreferencesView | null>(null);
  if (loaded.preferences !== adopted) {
    setAdopted(loaded.preferences);
    setView(loaded.preferences);
  }
  // The scope whose section has the form open.
  const [adding, setAdding] = useState<string | null>(null);
  const [announced, setAnnounced] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);

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
        "Accepted",
      ),
    onReject: async (id: ProposalId) =>
      settle(
        await client.decideProposal(id, { decision: "reject" }),
        (previous) => withoutProposal(previous, id),
        "Rejected",
      ),
  };

  const suggest = async (optionId: ModelOptionId | undefined): Promise<ModelActionResult> => {
    const result = await client.suggestPreferences(optionId === undefined ? {} : { optionId });
    if (!result.ok) return { ok: false, message: reason(result.error) };
    const { proposals: added, signals } = result.value;
    patch((previous) => ({ ...withProposals(previous, added), signalsSinceSuggestion: 0 }));
    return {
      ok: true,
      said:
        added.length === 0
          ? `Nothing new to suggest from ${plural(signals, "action")}.`
          : `${plural(added.length, "suggestion")} from ${plural(signals, "action")}, above.`,
    };
  };

  const importFrom = async (
    repo: RepoRef,
    optionId: ModelOptionId | undefined,
  ): Promise<ModelActionResult> => {
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
            ? "Found no pull request of this repository that you reviewed."
            : `Found no comment of yours on its last ${plural(pullRequests, "pull request")}.`,
      };
    }
    const read = `Read ${plural(comments, "comment")} from ${plural(pullRequests, "pull request")}`;
    return {
      ok: true,
      said:
        added.length === 0
          ? `${read}: nothing new to suggest.`
          : `${read}: ${plural(added.length, "suggestion")}, above.`,
    };
  };

  const switchGuideline = async (repo: RepoRef, path: GuidelinePath, enabled: boolean) =>
    settle(
      await client.setGuidelineSwitch({ repo, path, enabled }),
      (previous) => withGuidelineSwitch(previous, repo, path, enabled),
      enabled ? `${path} switched on` : `${path} switched off`,
    );

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
    const scopes = scopeOptions(repositories.map((one) => one.repo));
    const [everywhere] = scopes;
    if (everywhere === undefined) return null;
    const none = view.preferences.length === 0;
    const signals = view.signalsSinceSuggestion;
    return (
      <>
        <Suggested
          proposals={view.proposals}
          scopes={scopes}
          actions={proposals}
          fallbackFocus={heading}
        />
        <ModelAction
          label="Suggest from my reviews"
          running="Reading what you did in reviews…"
          icon={<SparklesIcon aria-hidden="true" />}
          choice={choice}
          blocked={signals === 0 ? NOTHING_RECORDED : null}
          idle={
            signals === 0
              ? NOTHING_RECORDED
              : `${plural(signals, "action")} recorded since the last suggestions`
          }
          run={suggest}
          now={now}
        />
        <ScopeSection
          option={everywhere}
          title="Everywhere"
          word="Used on every pull request"
          preferences={preferencesIn(view, GLOBAL)}
          scopes={scopes}
          actions={actions}
          addable={!none}
          adding={!none && adding === everywhere.key}
          onAdding={(open) => setAdding(open ? everywhere.key : null)}
          onAdd={add}
          empty={
            none ? (
              <div data-slot="no-preferences" className="flex flex-col gap-3 px-4 py-4">
                <WhatItIs />
                <PreferenceForm
                  legend="Add a preference"
                  initial={{ kind: "look-for", text: "", scope: GLOBAL }}
                  scopes={scopes}
                  submit="Add preference"
                  submitting="Adding…"
                  onSubmit={add}
                />
              </div>
            ) : (
              <p className="px-4 py-3 text-caption text-muted-foreground">
                No preference for every repository yet.
              </p>
            )
          }
        />
        {repositories.map(({ repo, guidelineFiles, guidelineNote }) => {
          const option = scopes.find((one) => one.key === repoKey(repo)) ?? everywhere;
          return (
            <ScopeSection
              key={option.key}
              option={option}
              title={
                <>
                  <span className="min-w-0 truncate">{repoName(repo)}</span>
                  <Badge variant="outline" className="font-normal text-muted-foreground">
                    {HOST_NAMES[repo.host]}
                  </Badge>
                </>
              }
              word="Used on its pull requests, after the ones for everywhere"
              preferences={preferencesIn(view, option.scope)}
              scopes={scopes}
              actions={actions}
              adding={adding === option.key}
              onAdding={(open) => setAdding(open ? option.key : null)}
              onAdd={add}
              empty={
                <p className="px-4 py-3 text-caption text-muted-foreground">
                  No preference for this repository yet.
                </p>
              }
            >
              <GuidelineFiles
                files={guidelineFiles}
                note={guidelineNote}
                repository={repoName(repo)}
                onSwitch={(path, enabled) => switchGuideline(repo, path, enabled)}
              />
              <div className="border-t px-4 py-3">
                <ModelAction
                  label="Import from my past reviews"
                  running={`Reading your comments on ${repoName(repo)}…`}
                  icon={<HistoryIcon aria-hidden="true" />}
                  choice={choice}
                  what={`Reads your own comments on its recent pull requests on ${HOST_NAMES[repo.host]}, then runs`}
                  run={(optionId) => importFrom(repo, optionId)}
                  now={now}
                />
              </div>
            </ScopeSection>
          );
        })}
      </>
    );
  };

  return (
    <div data-slot="preferences-page" className="mx-auto flex max-w-[960px] flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 ref={heading} tabIndex={-1} className="text-title font-semibold tracking-[-0.01em]">
          Preferences
        </h1>
        <p className="text-muted-foreground">
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
