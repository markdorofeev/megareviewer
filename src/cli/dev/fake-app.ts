import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { type ErrorResponse, TOKEN_HEADER } from "../../../contracts/index.ts";
import type {
  AnalysisModel,
  CodeParser,
  Logger,
  ProposalDraft,
} from "../../application/ports/index.ts";
import {
  allFixtures,
  FakeAnalysisModel,
  FakeGitHost,
  type FakeHarnessSource,
  FakeLocalCheckouts,
  FakeModelCatalog,
  FakePreferenceSuggester,
  FakePullRequestStatusSource,
  FakeRepositoryCopies,
  FakeReviewHistory,
  FakeReviewThreads,
  FakeTicketSource,
  fakeModelOption,
  fixtureReviewers,
  InMemoryAnalysisStore,
  InMemoryFileCache,
  InMemoryHarnessStore,
  InMemoryKnownCheckouts,
  InMemoryPreferenceStore,
  type PullRequestFixture,
  smallFeature,
  smallFeatureStatus,
  smallFeatureThreadList,
} from "../../application/testing/index.ts";
import {
  type HostKind,
  type HostUser,
  type PastComment,
  type PullRequestRef,
  parsePullRequestUrl,
  pullRequestUrl,
  type Reviewer,
  Sha,
} from "../../domain/review/index.ts";
import { err } from "../../domain/shared/index.ts";
import {
  allowedHosts,
  assemble,
  type Composition,
  harnessSourceIn,
  systemClock,
} from "../compose.ts";
import recordingJson from "./fixtures/model-run-small-feature.synthetic.json" with { type: "json" };
import { createReplayAnalysisModel, ModelRecording, type Scenario } from "./model-recording.ts";
import { checkedAdvisor, checkedFindings, receiptsChecked } from "./receipts-checked.ts";
import { downloadedCommits, receiptsDownloaded } from "./receipts-downloaded.ts";
import { guidedFindings, receiptsGuided } from "./receipts-guided.ts";
import { fakeHarnessSources, receiptsHarness } from "./receipts-harness.ts";
import { receiptsTour, withTour } from "./receipts-tour.ts";
import { receiptsTyped, typedFindings } from "./receipts-typed.ts";
import { withFindings } from "./with-findings.ts";

/** The recorded run the scenarios play, read once at startup. */
const recording = ModelRecording.parse(recordingJson);

const failingRef = { ...smallFeature.pullRequest.ref, number: 104 };

/** small-feature again, as a PR whose first analysis fails, to exercise the failed-analysis flow. */
export const intentFailsOnce: PullRequestFixture = {
  ...smallFeature,
  name: "intent-fails-once",
  pullRequest: {
    ...smallFeature.pullRequest,
    ref: failingRef,
    url: pullRequestUrl(failingRef),
    title: `${smallFeature.pullRequest.title} (intent fails once)`,
  },
};

export const fakeFixtures: readonly PullRequestFixture[] = [
  ...allFixtures,
  intentFailsOnce,
  receiptsGuided,
  receiptsChecked,
  receiptsTour,
  receiptsHarness,
  receiptsDownloaded,
  receiptsTyped,
];

const FAKE_MODELS = [
  ["claude-haiku-5-5", "Haiku 5.5"],
  ["claude-sonnet-5-5", "Sonnet 5.5"],
  ["claude-opus-5-5", "Opus 5.5"],
] as const;

/** What the fake model proposes, from signals and from past comments alike. */
export const fakeProposalDrafts: readonly ProposalDraft[] = [
  {
    kind: "dont-flag",
    text: "Missing JSDoc on internal helpers",
    scope: "repo",
    evidence: [
      "Dismissed: Missing JSDoc on `parseConfig`, acme/shop #101",
      "Dismissed: Missing JSDoc on `renderReceipt`, acme/shop #101",
    ],
  },
  {
    kind: "look-for",
    text: "Cached data that outlives a change to what it was made from",
    scope: "global",
    evidence: [
      "Raised: Serves a stale receipt for an hour after its order changes, acme/shop #101",
      'Comment: "What invalidates this when the order is refunded?", acme/shop #101',
    ],
  },
];

const shop = smallFeature.pullRequest.ref.repo;

/** The reviewer's comments on small-feature's repository, on pull requests before it. */
export const fakePastComments: readonly PastComment[] = [
  {
    pullRequest: { repo: shop, number: 96 },
    path: "src/services/orders.ts",
    body: "This cache never hears about refunds. What invalidates it?",
    at: "2026-10-14T15:20:00.000Z",
  },
  {
    pullRequest: { repo: shop, number: 96 },
    path: "src/routes/orders.ts",
    body: "The lookup isn't scoped to the signed-in user.",
    at: "2026-10-14T15:12:00.000Z",
  },
  {
    pullRequest: { repo: shop, number: 88 },
    path: "src/services/catalog.ts",
    body: "Same as last time: the price is cached with no way to expire it when the product changes.",
    at: "2026-10-02T09:40:00.000Z",
  },
];

/**
 * Claude's three models on Claude Code, which the fake model answers for, and on the Anthropic
 * API, which has no credentials, as on a machine signed in to Claude Code only.
 */
const fakeModels = (model: AnalysisModel, available: boolean): FakeModelCatalog =>
  new FakeModelCatalog({
    model,
    suggester: new FakePreferenceSuggester({ drafts: fakeProposalDrafts }),
    advisor: checkedAdvisor(),
    defaultModel: "claude-sonnet-5-5",
    options: [
      ...FAKE_MODELS.map(([id, modelName]) =>
        fakeModelOption({
          model: id,
          modelName,
          available,
          reason: available ? null : "fake mode started with --no-ai",
        }),
      ),
      ...FAKE_MODELS.map(([id, modelName]) =>
        fakeModelOption({
          provider: "anthropic-api",
          providerName: "Anthropic API",
          model: id,
          modelName,
          via: "Anthropic API",
          available: false,
          reason:
            "No Anthropic API credentials: set ANTHROPIC_API_KEY or run `ant auth login` to use the Anthropic API",
        }),
      ),
    ],
  });

/** The model fails its first intent pass for `url` as overloaded; the next run succeeds. */
export const failingIntentOnce = (model: AnalysisModel, url: string): AnalysisModel => {
  let failed = false;
  return {
    version: model.version,
    readsHarness: model.readsHarness,
    checkSize: (input) => model.checkSize(input),
    async intent(input, options) {
      if (failed || input.pullRequest.url !== url) return model.intent(input, options);
      failed = true;
      return err({
        kind: "overloaded",
        message: "The fake model fails this PR's first intent pass. Try again.",
      });
    },
    findings: (input, intent, options) => model.findings(input, intent, options),
    steps: (input, options) => model.steps(input, options),
  };
};

const PostsRequest = z.object({ n: z.number().int().positive() });
const SetHeadRequest = z.object({ url: z.string(), headSha: Sha });

const badRequest = (message: string): ErrorResponse => ({
  error: { code: "bad-request", message },
});

/**
 * Routes for end-to-end tests, under /__fake/. Behind the same Host check and session token as
 * the API: the fake app is for the developer's own tab only, too.
 */
export const controlRoutes = (options: {
  readonly github: FakeGitHost;
  readonly bitbucket: FakeGitHost;
  readonly threads: readonly FakeReviewThreads[];
  readonly copies: FakeRepositoryCopies;
  readonly sessionToken: string;
  readonly allowedHosts: readonly string[];
}): Hono => {
  const hosts = { github: options.github, bitbucket: options.bitbucket };
  const allowed = new Set(options.allowedHosts);
  const expected = Buffer.from(options.sessionToken);
  const tokenMatches = (given: string | undefined) =>
    given !== undefined &&
    Buffer.byteLength(given) === expected.length &&
    timingSafeEqual(Buffer.from(given), expected);

  let releaseDownloads = () => {};

  return new Hono()
    .use(async (c, next) => {
      if (!allowed.has(c.req.header("host")?.toLowerCase() ?? "")) {
        return c.text("Forbidden host", 403);
      }
      if (!tokenMatches(c.req.header(TOKEN_HEADER))) {
        const body: ErrorResponse = {
          error: { code: "unauthorized", message: "Missing or wrong session token" },
        };
        return c.json(body, 401);
      }
      await next();
    })
    .get("/publications", (c) =>
      c.json({ attempts: [...hosts.github.publishAttempts, ...hosts.bitbucket.publishAttempts] }),
    )
    .post("/fail-publish-comment", async (c) => {
      const body = PostsRequest.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json(badRequest("Expected { n: a positive integer }"), 400);
      // On both hosts: whichever the next publish goes to. Post 1 is the summary.
      for (const host of Object.values(hosts)) {
        host.failPublishAtPost(body.data.n, {
          kind: "unexpected",
          message: `The fake host fails post ${body.data.n}`,
          retryAfterSeconds: null,
        });
      }
      return c.json({});
    })
    .post("/hold-downloads", (c) => {
      releaseDownloads = options.copies.hold();
      return c.json({});
    })
    .post("/release-downloads", (c) => {
      releaseDownloads();
      return c.json({});
    })
    .post("/set-head", async (c) => {
      const body = SetHeadRequest.safeParse(await c.req.json().catch(() => null));
      if (!body.success) {
        return c.json(badRequest("Expected { url, headSha: 40 lowercase hex characters }"), 400);
      }
      const ref = parsePullRequestUrl(body.data.url);
      if (!ref.ok) return c.json(badRequest(`Not a PR URL: ${body.data.url}`), 400);
      try {
        hosts[ref.value.repo.host].setHeadSha(ref.value, body.data.headSha);
      } catch {
        return c.json(badRequest(`No fixture PR at ${body.data.url}`), 400);
      }
      return c.json({});
    });
};

export interface FakeApp {
  readonly composition: Composition;
  readonly github: FakeGitHost;
  readonly bitbucket: FakeGitHost;
  readonly threads: { readonly github: FakeReviewThreads; readonly bitbucket: FakeReviewThreads };
  readonly preferences: InMemoryPreferenceStore;
  readonly harnessSources: Record<HostKind, FakeHarnessSource>;
  readonly harnessStore: InMemoryHarnessStore;
  /** The API and UI like the real CLI's, plus the control routes. */
  app(port: number): Hono;
}

/**
 * The real use cases and HTTP app on fakes seeded with every fixture, and in-memory stores.
 * Preferences start empty; the fake model proposes two, from the signals or from the three
 * comments GitHub's history has on small-feature's repository.
 */
export const createFakeApp = async (options: {
  readonly parser: CodeParser;
  readonly logger: Logger;
  readonly version: string;
  readonly staticDir: string | null;
  readonly sessionToken?: string;
  /** Whether Request AI review can run the fake model. Available unless false. */
  readonly modelAvailable?: boolean;
  /** Plays the recorded model run as this scenario instead of answering from the fake model. */
  readonly scenario?: Scenario;
  /** Whether a commit no clone has is downloaded. Only receipts-downloaded's host has it. */
  readonly download?: boolean;
}): Promise<FakeApp> => {
  const clock = systemClock;
  const copies = new FakeRepositoryCopies({
    commits: downloadedCommits,
    downloadFolder: options.download === true ? "/home/lee/.megareviewer/repos" : null,
    clock,
  });
  const github = new FakeGitHost({ host: "github", fixtures: fakeFixtures, clock });
  const bitbucket = new FakeGitHost({ host: "bitbucket", fixtures: fakeFixtures, clock });
  const threads = {
    github: new FakeReviewThreads({ host: "github", clock }),
    bitbucket: new FakeReviewThreads({ host: "bitbucket", clock }),
  };
  // small-feature has a conversation on its code; the other fixtures have none.
  threads.github.setThreads(smallFeature.pullRequest.ref, smallFeatureThreadList);
  // A review published from the page shows in the status, as the host would show it.
  const viewerOn =
    (host: FakeGitHost, user: HostUser) =>
    (ref: PullRequestRef): Reviewer | null => {
      const verdict = host.verdictOn(ref);
      return verdict === null ? null : { ...user, team: false, verdict };
    };
  const statuses = {
    github: new FakePullRequestStatusSource({
      host: "github",
      viewer: viewerOn(github, fixtureReviewers.github),
    }),
    bitbucket: new FakePullRequestStatusSource({
      host: "bitbucket",
      viewer: viewerOn(bitbucket, fixtureReviewers.bitbucket),
    }),
  };
  statuses.github.setStatus(smallFeature.pullRequest.ref, smallFeatureStatus);
  const preferences = new InMemoryPreferenceStore();
  const harnessSources = fakeHarnessSources(fakeFixtures);
  const harnessStore = new InMemoryHarnessStore(clock);
  const composition = await assemble(
    {
      hosts: { github, bitbucket },
      threads,
      statuses,
      tickets: new FakeTicketSource({
        tickets: fakeFixtures.flatMap((fixture) => fixture.tickets),
      }),
      models: fakeModels(
        withTour(
          withFindings(
            withFindings(
              withFindings(
                options.scenario === undefined
                  ? failingIntentOnce(
                      new FakeAnalysisModel({ readsHarness: true }),
                      intentFailsOnce.pullRequest.url,
                    )
                  : createReplayAnalysisModel(recording, { scenario: options.scenario }),
                receiptsGuided.pullRequest.url,
                guidedFindings,
              ),
              receiptsChecked.pullRequest.url,
              checkedFindings,
            ),
            receiptsTyped.pullRequest.url,
            typedFindings,
          ),
          receiptsTour.pullRequest.url,
        ),
        options.modelAvailable !== false,
      ),
      store: new InMemoryAnalysisStore(clock),
      preferences,
      history: { github: new FakeReviewHistory({ host: "github", comments: fakePastComments }) },
      fileCache: new InMemoryFileCache(),
      harnessSource: harnessSourceIn(harnessSources),
      harnessStore,
      checkouts: new FakeLocalCheckouts(),
      knownCheckouts: new InMemoryKnownCheckouts(),
      copies,
      parser: options.parser,
      clock,
      logger: options.logger,
    },
    {
      staticDir: options.staticDir,
      version: options.version,
      ...(options.sessionToken !== undefined && { sessionToken: options.sessionToken }),
      close: async () => {},
    },
  );
  return {
    composition,
    github,
    bitbucket,
    threads,
    preferences,
    harnessSources,
    harnessStore,
    app: (port) => {
      const real = composition.app(port);
      const control = controlRoutes({
        github,
        bitbucket,
        threads: [threads.github, threads.bitbucket],
        copies,
        sessionToken: composition.sessionToken,
        allowedHosts: allowedHosts(port),
      });
      return new Hono().route("/__fake", control).all("*", (c) => real.fetch(c.req.raw, c.env));
    },
  };
};
