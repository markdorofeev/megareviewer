import { PlusIcon, SparklesIcon } from "lucide-react";
import { type ReactNode, type RefObject, useId } from "react";
import type { PreferencesView, RepositoryPreferences } from "../../../../contracts/index.ts";
import type { GuidelinePath, HostKind, RepoRef } from "../../../../src/domain/review/index.ts";
import { cn } from "../../lib/utils.ts";
import { HOST_NAMES } from "../picker/PullRequestList.tsx";
import { GuidelineFiles } from "./GuidelineFiles.tsx";
import { HostIcon } from "./HostIcon.tsx";
import { ModelActionButton, type ModelActionProps, ModelActionStatus } from "./ModelAction.tsx";
import { PreferenceForm, type RuleFields } from "./PreferenceForm.tsx";
import { type PreferenceActions, PreferenceList } from "./PreferenceList.tsx";
import { KindChip, repoName, ScopeIcon, type ScopeOption } from "./rule.tsx";
import { type ProposalActions, SuggestionList } from "./Suggested.tsx";
import { isFirstRun, preferencesIn, proposalGroups, proposalsIn } from "./view.ts";

/** What every panel reads and does, kept by the page. */
export interface PanelContext {
  readonly view: PreferencesView;
  readonly scopes: readonly ScopeOption[];
  readonly actions: PreferenceActions;
  readonly proposals: ProposalActions;
  readonly add: (fields: RuleFields) => Promise<string | null>;
  readonly switchGuideline: (
    repo: RepoRef,
    path: GuidelinePath,
    enabled: boolean,
  ) => Promise<string | null>;
  readonly suggest: ModelActionProps;
  readonly importFrom: (repo: RepoRef) => ModelActionProps;
  /** The panel's title, which takes the focus when a scope is chosen or the last proposal goes. */
  readonly heading: RefObject<HTMLHeadingElement | null>;
  /** The title's ID, which names the panel. */
  readonly headingId: string;
}

const NO_SUGGESTIONS =
  "No suggestions yet. megareviewer suggests preferences from the points you raise or dismiss and the comments you post.";

const Header = ({
  context,
  title,
  host,
  word,
  actions,
}: {
  readonly context: PanelContext;
  readonly title: string;
  readonly host?: HostKind;
  readonly word: string;
  readonly actions: ReactNode;
}) => (
  <header className="flex flex-wrap items-start gap-x-4 gap-y-3">
    <div className="min-w-0 flex-1 basis-64">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <h2
          ref={context.heading}
          id={context.headingId}
          tabIndex={-1}
          className="text-[1.125rem] leading-[1.625rem] font-semibold [overflow-wrap:anywhere]"
        >
          {title}
        </h2>
        {host !== undefined && (
          <span className="inline-flex items-center gap-1 text-caption text-muted-foreground">
            <HostIcon host={host} className="size-3" />
            {HOST_NAMES[host]}
          </span>
        )}
      </div>
      <p className="mt-1 text-ui text-muted-foreground">{word}</p>
    </div>
    {actions !== null && (
      // On the title's line its width pushes them right; wrapped, they start under it.
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    )}
  </header>
);

/** A run's status lines under the header, or nothing while they have nothing to say. */
const Statuses = ({
  runs,
  className = "mt-2",
}: {
  readonly runs: readonly ModelActionProps[];
  readonly className?: string;
}) => (
  <div className={cn("flex flex-col gap-1 empty:hidden", className)}>
    {runs.map((run) => (
      <ModelActionStatus key={run.label} {...run} />
    ))}
  </div>
);

/** A calm heading over a panel's part, with its count only above zero. */
const Section = ({
  title,
  count = 0,
  icon,
  children,
}: {
  readonly title: string;
  readonly count?: number;
  readonly icon?: ReactNode;
  readonly children: ReactNode;
}) => {
  const id = useId();
  return (
    <section aria-labelledby={id} className="mt-7">
      <h3
        id={id}
        className="mb-2 flex items-center gap-1.5 text-caption font-semibold text-muted-foreground"
      >
        {icon}
        {title}
        {/* A space between the words for the heading's name; a flex box doesn't draw it. */}
        {count > 0 && (
          <>
            {" "}
            <span className="tabular font-medium">{count}</span>
          </>
        )}
      </h3>
      {children}
    </section>
  );
};

const Suggestions = ({
  context,
  option,
  title = "Suggestions from your reviews",
  icon,
}: {
  readonly context: PanelContext;
  readonly option: ScopeOption;
  readonly title?: string;
  readonly icon?: ReactNode;
}) => {
  const waiting = proposalsIn(context.view, option.scope);
  if (waiting.length === 0) return null;
  return (
    <Section title={title} count={waiting.length} icon={icon}>
      <SuggestionList
        proposals={waiting}
        scopes={context.scopes}
        actions={context.proposals}
        label={`Suggestions for ${option.label}`}
        fallbackFocus={context.heading}
      />
    </Section>
  );
};

const Preferences = ({
  context,
  option,
}: {
  readonly context: PanelContext;
  readonly option: ScopeOption;
}) => {
  const preferences = preferencesIn(context.view, option.scope);
  if (preferences.length === 0) return null;
  return (
    <Section title="Preferences" count={preferences.length}>
      <PreferenceList
        preferences={preferences}
        scopes={context.scopes}
        actions={context.actions}
        label={`Preferences for ${option.label}`}
      />
    </Section>
  );
};

const AddPreference = ({
  context,
  option,
}: {
  readonly context: PanelContext;
  readonly option: ScopeOption;
}) => (
  <Section title="Add a preference">
    <div className="rounded-lg border bg-card p-4">
      <PreferenceForm
        // A new scope's form starts on that scope.
        key={option.key}
        legend="Add a preference"
        initial={{ kind: "look-for", text: "", scope: option.scope }}
        scopes={context.scopes}
        submit="Add preference"
        submitting="Adding…"
        submitIcon={<PlusIcon aria-hidden="true" />}
        onSubmit={context.add}
      />
    </div>
  </Section>
);

/** What a preference is, with both kinds' chips in the sentence. */
const WhatItIs = ({
  where,
  children,
}: {
  readonly where: string;
  readonly children?: ReactNode;
}) => (
  <p className="max-w-[620px] text-body">
    No preferences for {where} yet. A preference is one rule for AI reviews
    {where === "this repository" ? " here" : ""}:{" "}
    <KindChip kind="look-for" className="align-middle" /> something to look for, or{" "}
    <KindChip kind="dont-flag" className="align-middle" /> something not to flag.
    {children}
  </p>
);

export const EverywherePanel = ({
  context,
  option,
}: {
  readonly context: PanelContext;
  readonly option: ScopeOption;
}) => {
  const empty =
    preferencesIn(context.view, option.scope).length === 0 &&
    proposalsIn(context.view, option.scope).length === 0;
  return (
    <>
      <Header
        context={context}
        title="Everywhere"
        word="Used on every pull request, in every repository."
        actions={<ModelActionButton {...context.suggest} />}
      />
      <Statuses runs={[context.suggest]} />
      <Suggestions context={context} option={option} />
      <Preferences context={context} option={option} />
      {empty && (
        <div className="mt-5 flex flex-col gap-2">
          <WhatItIs where="every repository" />
          {/* With nothing recorded, Suggest's own line already says where suggestions come from. */}
          {context.view.proposals.length === 0 && context.view.signalsSinceSuggestion > 0 && (
            <p className="max-w-[620px] text-ui text-muted-foreground">{NO_SUGGESTIONS}</p>
          )}
        </div>
      )}
      <AddPreference context={context} option={option} />
    </>
  );
};

export const RepositoryPanel = ({
  context,
  option,
  repository,
}: {
  readonly context: PanelContext;
  readonly option: ScopeOption;
  readonly repository: RepositoryPreferences;
}) => {
  const { repo, guidelineFiles, guidelineNote } = repository;
  const imports = { ...context.importFrom(repo), size: "sm" as const };
  const runs = [context.suggest, imports];
  const firstRun = isFirstRun(context.view, option.scope);
  const quiet = { ...context.suggest, size: "sm" as const };
  return (
    <>
      <Header
        context={context}
        title={repoName(repo)}
        host={repo.host}
        word="Used on its pull requests, after the ones for Everywhere."
        // In a first run they're in the box below, so each is on the screen once.
        actions={
          firstRun ? null : (
            <>
              <ModelActionButton {...imports} />
              <ModelActionButton {...context.suggest} />
            </>
          )
        }
      />
      {!firstRun && <Statuses runs={runs} />}
      <Suggestions context={context} option={option} />
      <Preferences context={context} option={option} />
      {firstRun && (
        <div className="mt-5 flex flex-col gap-3">
          <WhatItIs where="this repository">
            {" "}
            <span className="text-muted-foreground">Rules for Everywhere still apply.</span>
          </WhatItIs>
          <div
            data-slot="first-run"
            className="flex gap-3 rounded-lg border border-dashed border-ai-soft-bd px-3.5 py-3"
          >
            <SparklesIcon aria-hidden="true" className="mt-0.5 size-[15px] shrink-0 text-primary" />
            <div className="flex min-w-0 flex-1 flex-col gap-2.5">
              <p className="max-w-[620px] text-ui text-muted-foreground">
                Not sure where to start? megareviewer can suggest rules from the points you raised
                or dismissed and the comments you posted, or from your past comments on this
                repository's pull requests.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <ModelActionButton {...quiet} />
                <ModelActionButton {...imports} />
              </div>
              <Statuses runs={[quiet, imports]} className="" />
            </div>
          </div>
        </div>
      )}
      <AddPreference context={context} option={option} />
      <Section title="Guideline files">
        <GuidelineFiles
          files={guidelineFiles}
          note={guidelineNote}
          onSwitch={(path, enabled) => context.switchGuideline(repo, path, enabled)}
        />
      </Section>
    </>
  );
};

export const SuggestionsPanel = ({ context }: { readonly context: PanelContext }) => {
  const groups = proposalGroups(context.view, context.scopes);
  return (
    <>
      <Header
        context={context}
        title="Suggestions"
        word="From the points you raised or dismissed and the comments you posted. Add one to make it a preference where shown."
        actions={<ModelActionButton {...context.suggest} />}
      />
      <Statuses runs={[context.suggest]} />
      {groups.length === 0 ? (
        <p className="mt-5 text-ui text-muted-foreground">No suggestions yet.</p>
      ) : (
        groups.map(({ option }) => (
          <Suggestions
            key={option.key}
            context={context}
            option={option}
            title={option.label}
            icon={<ScopeIcon scope={option.scope} className="size-3.5" />}
          />
        ))
      )}
    </>
  );
};
