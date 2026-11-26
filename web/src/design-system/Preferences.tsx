import { PlusIcon, SparklesIcon } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import type { PreferencesView, RepositoryPreferences } from "../../../contracts/index.ts";
import {
  emptyPreferencesView,
  fixtureHarnessSection,
  fixtureModelOptions,
  fixtureNothingYet,
  fixturePreferencesView,
  lockedModelOptions,
} from "../../dev/fixtures/index.ts";
import { mockFetch } from "../../dev/mock-fetch.ts";
import { createMockApi, MOCK_TOKEN } from "../../dev/mock-routes.ts";
import { type Api, ApiContext, createApiClient } from "../api/index.ts";
import { ConnectionsProvider } from "../app/connections-context.tsx";
import { GuidelineFiles } from "../pages/preferences/GuidelineFiles.tsx";
import { ModelAction } from "../pages/preferences/ModelAction.tsx";
import { PreferenceForm } from "../pages/preferences/PreferenceForm.tsx";
import { PreferencesPage } from "../pages/preferences/PreferencesPage.tsx";
import { GLOBAL } from "../pages/preferences/rule.tsx";
import { POINT_GUIDANCE, useDemoChoice } from "./fixtures.ts";

// Made-up data for the preview: a reviewer's rules, proposals and a repository's guideline files.

const NOW = Date.parse("2026-10-21T15:00:00Z");
const now = () => NOW;
const LONG_RULE =
  "Tenant isolation: every query, every cache key, every background job, every export and every log line that names a customer filters by the tenant ID of the signed-in user, and nothing reads another tenant's rows, files, queues or secrets, whatever the role of the caller, the feature flag in force or the environment it runs in";
const noRun = async () => ({ ok: true as const, said: "" });
const noSave = async () => null;

const Example = ({ title, children }: { readonly title: string; readonly children: ReactNode }) => (
  <div className="flex min-w-0 flex-col gap-2">
    <h4 className="text-caption font-medium text-muted-foreground">{title}</h4>
    {children}
  </div>
);

const Group = ({ title, children }: { readonly title: string; readonly children: ReactNode }) => (
  <section className="flex flex-col gap-3">
    <h3 className="text-heading font-semibold">{title}</h3>
    {children}
  </section>
);

/** What the preferences read answers instead of the view: never, or a failure. */
type Read = "never" | "fails";

const READS: Readonly<Record<Read, () => Promise<Response>>> = {
  never: () => new Promise(() => {}),
  fails: async () =>
    new Response(
      JSON.stringify({ error: { code: "internal", message: "The preferences couldn't be read" } }),
      { status: 500, headers: { "content-type": "application/json" } },
    ),
};

/** The page over an API that keeps the preferences in memory, so its examples can be used. */
const Page = ({
  view,
  read,
  startOn,
}: {
  readonly view?: PreferencesView;
  readonly read?: Read;
  readonly startOn?: string;
}) => {
  const api = useMemo((): Api => {
    const mock = mockFetch(createMockApi(view === undefined ? {} : { preferences: view }));
    const fetch: typeof globalThis.fetch = (input, init) =>
      read !== undefined && String(input) === "/api/preferences" && init?.method === "GET"
        ? READS[read]()
        : mock(input, init);
    return {
      client: createApiClient({ fetch, token: MOCK_TOKEN, onUnauthorized: () => {} }),
      subscribe: () => () => {},
    };
  }, [view, read]);
  return (
    <ApiContext.Provider value={api}>
      <ConnectionsProvider now={now}>
        <div className="rounded-xl border bg-background p-4">
          <PreferencesPage now={now} startOn={startOn ?? "global"} />
        </div>
      </ConnectionsProvider>
    </ApiContext.Provider>
  );
};

const withFirstRun: PreferencesView = {
  ...fixturePreferencesView,
  repositories: [...fixturePreferencesView.repositories, fixtureNothingYet],
};

/** The fixture's CLAUDE.md switched on, with one of the files it links off. */
const switchedOn: RepositoryPreferences = {
  ...fixtureHarnessSection,
  guidelineFiles: (fixtureHarnessSection.guidelineFiles ?? []).map((file) =>
    file.path === "CLAUDE.md"
      ? {
          ...file,
          enabled: true,
          use: "on-request",
          linked: file.linked.map((one) =>
            one.path === "docs/runbooks/README.md"
              ? { ...one, enabled: false, use: null }
              : one.linkedFrom === "docs/runbooks/README.md"
                ? { ...one, use: null }
                : one,
          ),
        }
      : file,
  ),
};

/** A harness that reached a limit, with a file that couldn't be read, and a load that failed since. */
const cutShort: RepositoryPreferences = {
  ...fixtureHarnessSection,
  harnessCut: "files",
  harnessSkipped: [
    { path: "docs/changelog.md", reason: "too-large" },
    { path: "docs/diagram.md", reason: "unreadable" },
  ],
  harnessNote:
    "Couldn't load the latest pull request's, so these are an earlier one's: GitHub's rate limit is reached",
};

/** Guideline files with what they link: folded, open, and cut by a limit. */
const Harnesses = () => (
  <div className="grid gap-4 rounded-xl border bg-background p-4">
    <Example title="Linked files, folded">
      <GuidelineFiles section={fixtureHarnessSection} onSwitch={noSave} />
    </Example>
    <Example title="Linked files, open">
      <GuidelineFiles section={switchedOn} startOpen={["CLAUDE.md"]} onSwitch={noSave} />
    </Example>
    <Example title="Cut by a limit">
      <GuidelineFiles section={cutShort} onSwitch={noSave} />
    </Example>
  </div>
);

/** The button that asks a model for proposals, in each state a run leaves it in. */
const SuggestStates = () => {
  const choice = useDemoChoice(fixtureModelOptions);
  const locked = useDemoChoice(lockedModelOptions);
  const suggest = {
    label: "Suggest from my reviews",
    running: "Reading your reviews of acme/shop…",
    icon: <SparklesIcon aria-hidden="true" />,
    what: "Reads what you did on its pull requests here and your comments on GitHub, then runs",
    run: noRun,
    now,
  };
  return (
    <div className="grid gap-4 rounded-xl bg-surface-subtle p-4 lg:grid-cols-2">
      <Example title="Ready">
        <ModelAction {...suggest} choice={choice} />
      </Example>
      <Example title="No model can run">
        <ModelAction {...suggest} choice={locked} />
      </Example>
      <Example title="Running">
        <ModelAction
          {...suggest}
          choice={choice}
          initial={{ is: "running", since: NOW - 12_000 }}
        />
      </Example>
      <Example title="Failed">
        <ModelAction
          {...suggest}
          choice={choice}
          initial={{
            is: "failed",
            message: "The model call failed: Your Claude plan's usage limit is reached.",
          }}
        />
      </Example>
      <Example title="Done">
        <ModelAction
          {...suggest}
          choice={choice}
          initial={{
            is: "done",
            said: "Read 92 comments from 30 pull requests and 14 actions recorded here: 2 suggestions, 1 for Everywhere and 1 for acme/shop.",
          }}
        />
      </Example>
    </div>
  );
};

/** The preferences page in each panel and each state of its read, and the parts with states of their own. */
export const Preferences = () => (
  <div className="flex flex-col gap-8">
    <Group title="A repository">
      <Page view={fixturePreferencesView} startOn="github/acme/shop" />
    </Group>
    <Group title="A repository's first run">
      <Page view={withFirstRun} startOn="github/acme/payments-ledger-reconciliation-service" />
    </Group>
    <Group title="Guideline files and what they link">
      <Harnesses />
    </Group>
    <Group title="Suggestions">
      <Page view={fixturePreferencesView} startOn="suggestions" />
    </Group>
    <Group title="Everywhere, without a preference">
      <Page view={emptyPreferencesView} />
    </Group>
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Group title="Loading">
        <Page read="never" />
      </Group>
      <Group title="The read failed">
        <Page read="fails" />
      </Group>
    </div>
    <Group title="Suggest from my reviews">
      <SuggestStates />
    </Group>
    <Group title="The form">
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Example title="Too long to save">
          <div className="rounded-lg border bg-card p-4">
            <PreferenceForm
              legend="A preference too long to save"
              initial={{ kind: "look-for", text: LONG_RULE, scope: GLOBAL }}
              scopes={POINT_GUIDANCE.ruleScopes}
              submit="Add preference"
              submitting="Adding…"
              submitIcon={<PlusIcon aria-hidden="true" />}
              onSubmit={noSave}
            />
          </div>
        </Example>
        <Example title="A rule saved from a point">
          <div className="rounded-lg border bg-card p-4">
            <PreferenceForm
              legend="Don't flag things like this"
              initial={{
                kind: "dont-flag",
                text: "Sleeps after the last attempt too",
                scope: POINT_GUIDANCE.ruleScopes[0]?.scope ?? GLOBAL,
              }}
              scopes={POINT_GUIDANCE.ruleScopes}
              kindFixed
              submit="Save and dismiss"
              submitting="Saving…"
              onCancel={() => {}}
              onSubmit={noSave}
            />
          </div>
        </Example>
      </div>
    </Group>
  </div>
);
