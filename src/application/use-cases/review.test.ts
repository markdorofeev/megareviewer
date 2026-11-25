import { describe, expect, it } from "vitest";
import {
  type Analysis,
  AnalysisId,
  buildPublication,
  CommentKey,
  type HostError,
  type HostUser,
  type HunkComment,
  PointId,
  PublicationId,
  type PublicationVerdict,
} from "../../domain/review/index.ts";
import { err, ok } from "../../domain/shared/index.ts";
import { createAnalysisEvents } from "../events/index.ts";
import {
  allFixtures,
  bitbucketBugfix,
  FakeCodeParser,
  FakeGitHost,
  FakeLocalCheckouts,
  FakeModelCatalog,
  FakeTicketSource,
  FixedClock,
  fakeModelOption,
  InMemoryAnalysisStore,
  InMemoryFileCache,
  InMemoryHarnessStore,
  InMemoryPreferenceStore,
  RecordingLogger,
  smallFeature,
  smallFeatureAnalysis,
} from "../testing/index.ts";
import { createUseCases } from "./index.ts";

const p = PointId.parse;
const { id } = smallFeatureAnalysis;
const { ref } = smallFeature.pullRequest;
const missingId = AnalysisId.parse("a_0000000000000000");
const network: HostError = { kind: "network", message: "socket hang up", retryAfterSeconds: null };
const firstId = PublicationId.parse("00000000-0000-4000-8000-000000000001");
const secondId = PublicationId.parse("00000000-0000-4000-8000-000000000002");

/** A preference store whose signal writes fail, as a full disk would make them. */
class FailingSignals extends InMemoryPreferenceStore {
  override async recordSignal(): Promise<void> {
    throw new Error("disk full");
  }
  override async removeSignal(): Promise<void> {
    throw new Error("disk full");
  }
}

const setup = (
  options: {
    githubUser?: HostUser;
    onlyGithub?: boolean;
    noHosts?: boolean;
    analysis?: Analysis;
    preferences?: InMemoryPreferenceStore;
  } = {},
) => {
  const clock = new FixedClock("2026-10-21T10:00:00Z");
  const github = new FakeGitHost({
    host: "github",
    fixtures: allFixtures,
    clock,
    ...(options.githubUser ? { user: options.githubUser } : {}),
  });
  const bitbucket = new FakeGitHost({ host: "bitbucket", fixtures: allFixtures, clock });
  const store = new InMemoryAnalysisStore();
  const preferences = options.preferences ?? new InMemoryPreferenceStore();
  const logger = new RecordingLogger();
  const tickets = new FakeTicketSource();
  const useCases = createUseCases(
    {
      hosts: options.noHosts ? {} : options.onlyGithub ? { github } : { github, bitbucket },
      tickets,
      models: new FakeModelCatalog(),
      store,
      fileCache: new InMemoryFileCache(),
      preferences,
      history: {},
      checkouts: new FakeLocalCheckouts(),
      harnessSource: () => null,
      harnessStore: new InMemoryHarnessStore(),
      threads: {},
      statuses: {},
      parser: new FakeCodeParser(),
      events: createAnalysisEvents(),
      clock,
      logger,
    },
    { version: "1.2.3" },
  );
  const seeded = store.saveAnalysis(options.analysis ?? smallFeatureAnalysis);
  return { clock, github, bitbucket, store, preferences, logger, useCases, seeded };
};

const running: Analysis = { ...smallFeatureAnalysis, status: "running" };

describe("getAnalysisView", () => {
  it("returns the analysis with its point reviews and publication", async () => {
    const { useCases, store, seeded } = setup();
    await seeded;
    const review = {
      pointId: p("d1"),
      state: "dismissed" as const,
      updatedAt: "2026-10-21T10:00:00Z",
    };
    await store.savePointReview(id, review);
    expect(await useCases.getAnalysisView(id)).toEqual(
      ok({
        analysis: smallFeatureAnalysis,
        pointReviews: [review],
        publication: null,
        isAuthor: false,
        currentUserId: "lee-park",
        stale: false,
      }),
    );
  });

  it("returns not-found for an unknown analysis", async () => {
    const { useCases } = setup();
    expect(await useCases.getAnalysisView(missingId)).toEqual(
      err({ code: "not-found", message: `No analysis ${missingId}` }),
    );
  });

  it("knows when the current user wrote the PR, asking the host by its repository", async () => {
    const { useCases, github, seeded } = setup({ githubUser: smallFeature.pullRequest.author });
    await seeded;
    const view = await useCases.getAnalysisView(id);
    expect(view.ok && view.value.isAuthor).toBe(true);
    expect(github.currentUserCalls).toEqual([smallFeature.pullRequest.ref.repo]);
  });

  it("isn't the author when the current user can't be fetched or the host is gone", async () => {
    const { useCases, github, seeded } = setup({ githubUser: smallFeature.pullRequest.author });
    await seeded;
    github.failNext("currentUser", network);
    const view = await useCases.getAnalysisView(id);
    expect(view.ok && view.value.isAuthor).toBe(false);

    const noHosts = setup({ noHosts: true });
    await noHosts.seeded;
    const hostless = await noHosts.useCases.getAnalysisView(id);
    expect(hostless.ok && [hostless.value.isAuthor, hostless.value.stale]).toEqual([false, false]);
  });

  it("caches whether the PR moved on for 60 seconds", async () => {
    const { useCases, github, clock, seeded } = setup();
    await seeded;
    const stale = async () => {
      const view = await useCases.getAnalysisView(id);
      return view.ok && view.value.stale;
    };
    expect(await stale()).toBe(false);
    github.setHeadSha(ref, "2".repeat(40));
    expect(await stale()).toBe(false);
    clock.advance(59_999);
    expect(await stale()).toBe(false);
    clock.advance(1);
    expect(await stale()).toBe(true);
  });

  it("isn't stale when the check fails or the analysis isn't complete", async () => {
    const { useCases, github, seeded } = setup();
    await seeded;
    github.setHeadSha(ref, "2".repeat(40));
    github.failNext("getPullRequest", network);
    const failedCheck = await useCases.getAnalysisView(id);
    expect(failedCheck.ok && failedCheck.value.stale).toBe(false);

    const incomplete = setup({ analysis: running });
    await incomplete.seeded;
    incomplete.github.setHeadSha(ref, "2".repeat(40));
    const view = await incomplete.useCases.getAnalysisView(id);
    expect(view.ok && view.value.stale).toBe(false);
  });
});

describe("getFileContent", () => {
  it("serves a changed file at the head or base commit, fetching it once", async () => {
    const { useCases, github, seeded } = setup();
    await seeded;
    const head = await useCases.getFileContent(id, "head", "config/app.yaml");
    expect(head).toEqual(ok({ content: smallFeature.headFiles["config/app.yaml"] }));
    const base = await useCases.getFileContent(id, "base", "config/app.yaml");
    expect(base).toEqual(ok({ content: smallFeature.baseFiles["config/app.yaml"] }));
    await useCases.getFileContent(id, "head", "config/app.yaml");
    expect(github.getFilesCalls).toHaveLength(2);
  });

  it("serves only the PR's own files, on the side they're on", async () => {
    const { useCases, seeded } = setup();
    await seeded;
    for (const [side, path] of [
      ["head", "package.json"],
      ["base", "src/services/receipts.ts"],
    ] as const) {
      const result = await useCases.getFileContent(id, side, path);
      expect(result.ok || result.error.code).toBe("not-found");
    }
    const missing = await useCases.getFileContent(missingId, "head", "config/app.yaml");
    expect(missing.ok || missing.error.code).toBe("not-found");
  });

  it("says when the host fails", async () => {
    const { useCases, github, seeded } = setup();
    await seeded;
    github.failNext("getFiles", network);
    const result = await useCases.getFileContent(id, "head", "config/app.yaml");
    expect(result).toEqual(err({ code: "host-error", message: "socket hang up" }));
  });
});

describe("recordPointState", () => {
  it("saves the state with the current time", async () => {
    const { useCases, store, seeded } = setup();
    await seeded;
    const saved = await useCases.recordPointState(id, p("f1"), "raised");
    const expected = { pointId: p("f1"), state: "raised", updatedAt: "2026-10-21T10:00:00.000Z" };
    expect(saved).toEqual(ok(expected));
    expect(await store.getPointReviews(id)).toEqual([expected]);
  });

  it("records a dismissed or raised point as a signal, with the point's text as it is", async () => {
    const { useCases, preferences, clock, seeded } = setup();
    await seeded;
    await useCases.recordPointState(id, p("f1"), "dismissed");
    clock.advance(1000);
    await useCases.recordPointState(id, p("d1"), "raised");

    const [finding] = smallFeatureAnalysis.findings;
    const [decision] = smallFeatureAnalysis.decisions;
    expect(await preferences.listSignals(10)).toEqual([
      {
        kind: "raised",
        at: "2026-10-21T10:00:01.000Z",
        pullRequest: ref,
        pointKind: "decision",
        title: decision?.title,
        text: decision?.whyItMatters,
        path: expect.any(String),
      },
      {
        kind: "dismissed",
        at: "2026-10-21T10:00:00.000Z",
        pullRequest: ref,
        pointKind: "finding",
        title: finding?.title,
        text: finding?.explanation,
        path: "src/services/receipts.ts",
      },
    ]);
  });

  it("keeps one signal per point, its latest state, and none once it's reopened", async () => {
    const { useCases, preferences, seeded } = setup();
    await seeded;
    await useCases.recordPointState(id, p("f1"), "dismissed");
    await useCases.recordPointState(id, p("f1"), "raised");
    expect((await preferences.listSignals(10)).map((signal) => signal.kind)).toEqual(["raised"]);

    await useCases.recordPointState(id, p("f1"), "open");
    expect(await preferences.listSignals(10)).toEqual([]);
  });

  it("keeps a signal's text after Remove AI review took the point away", async () => {
    const { useCases, preferences, seeded } = setup();
    await seeded;
    await useCases.recordPointState(id, p("f1"), "dismissed");

    expect((await useCases.removeModelRun(id)).ok).toBe(true);

    expect((await preferences.listSignals(10)).map((signal) => signal.title)).toEqual([
      smallFeatureAnalysis.findings[0]?.title,
    ]);
  });

  it("saves the state even when the signal can't be written or removed", async () => {
    const { useCases, store, logger, seeded } = setup({ preferences: new FailingSignals() });
    await seeded;

    expect((await useCases.recordPointState(id, p("f1"), "dismissed")).ok).toBe(true);
    expect((await useCases.recordPointState(id, p("d1"), "open")).ok).toBe(true);

    expect((await store.getPointReviews(id)).map((review) => review.state)).toEqual([
      "dismissed",
      "open",
    ]);
    expect(
      logger.entries.filter((entry) => entry.level === "warn").map((entry) => entry.message),
    ).toEqual(["Couldn't record a review signal", "Couldn't remove a review signal"]);
  });

  it("needs a complete analysis and a point it has", async () => {
    const { useCases, seeded } = setup();
    await seeded;
    expect(await useCases.recordPointState(id, p("d9"), "raised")).toEqual(
      err({ code: "not-found", message: `No point d9 in analysis ${id}` }),
    );
    expect(await useCases.recordPointState(missingId, p("d1"), "raised")).toEqual(
      err({ code: "not-found", message: `No analysis ${missingId}` }),
    );
    const incomplete = setup({ analysis: running });
    await incomplete.seeded;
    expect(await incomplete.useCases.recordPointState(id, p("d1"), "raised")).toEqual(
      err({ code: "analysis-not-complete", message: "The analysis isn't complete" }),
    );
  });
});

describe("publishing", () => {
  const commented = smallFeatureAnalysis.files[1]?.hunks[0];
  const commentedLine = commented?.lines.find((line) => line.kind === "add")?.newLine;
  if (commented === undefined || commentedLine == null) throw new Error("small-feature has a hunk");
  /** A raised point: its comment, as the reviewer left it. */
  const raised = {
    hunkComments: [
      { hunkId: commented.id, side: "new" as const, line: commentedLine, body: "Out of scope." },
    ],
    verdict: "request_changes" as const,
  };
  const raisedKey = CommentKey.parse(`hunk:${commented.id}:new:${commentedLine}`);
  /** The first review the page publishes, retried under the same ID. */
  const first = (
    summary: string,
    review: { hunkComments?: readonly HunkComment[]; verdict?: PublicationVerdict | null },
    allowStale = false,
  ) => ({
    publicationId: firstId,
    summary,
    allowStale,
    hunkComments: review.hunkComments ?? [],
    verdict: review.verdict ?? null,
  });
  const approval = { verdict: "approve" as const };

  it("previews exactly what it publishes", async () => {
    const { useCases, github, store, seeded } = setup();
    await seeded;
    const preview = await useCases.previewPublication(id, "Drop the rate limit.", raised);
    expect(preview).toEqual(
      ok(
        buildPublication({
          analysis: smallFeatureAnalysis,
          summary: "Drop the rate limit.",
          isAuthor: false,
          ...raised,
        }),
      ),
    );
    const receipt = await useCases.publishReview(id, first("Drop the rate limit.", raised));
    expect(receipt.ok).toBe(true);
    expect(github.publishAttempts).toHaveLength(1);
    expect(github.publishAttempts[0]?.publication).toEqual(preview.ok && preview.value);
    expect(github.publishAttempts[0]?.headSha).toBe(smallFeatureAnalysis.key.headSha);
    expect(await store.getPublications(id)).toEqual([
      { number: 1, id: firstId, receipt: receipt.ok && receipt.value },
    ]);
  });

  it("publishes comments on hunk lines and the reviewer's own verdict, and retries without repeats", async () => {
    const { useCases, github, seeded } = setup();
    await seeded;
    const hunk = smallFeatureAnalysis.files[1]?.hunks[0];
    const line = hunk?.lines.find((diffLine) => diffLine.kind === "add")?.newLine;
    if (hunk === undefined || line == null) throw new Error("small-feature has an added line");
    const review = {
      hunkComments: [{ hunkId: hunk.id, side: "new" as const, line, body: "Why 600?" }],
      verdict: "request_changes" as const,
    };
    const preview = await useCases.previewPublication(id, "", review);
    expect(preview.ok && preview.value.verdict).toBe("request_changes");
    expect(preview.ok && preview.value.comments).toEqual([
      {
        key: CommentKey.parse(`hunk:${hunk.id}:new:${line}`),
        path: hunk.path,
        line,
        side: "new",
        body: "Why 600?",
      },
    ]);

    github.failPublishAtPost(2, network);
    expect((await useCases.publishReview(id, first("", review))).ok).toBe(false);
    expect((await useCases.publishReview(id, first("", review))).ok).toBe(true);
    expect(github.publishAttempts.map((attempt) => attempt.postedKeys)).toEqual([
      ["summary"],
      [`hunk:${hunk.id}:new:${line}`],
    ]);
  });

  it("refuses a comment on a line the diff doesn't show", async () => {
    const { useCases, seeded } = setup();
    await seeded;
    const hunk = smallFeatureAnalysis.files[1]?.hunks[0];
    if (hunk === undefined) throw new Error("small-feature has hunks");
    const review = {
      hunkComments: [{ hunkId: hunk.id, side: "old" as const, line: 9_999, body: "x" }],
      verdict: null,
    };
    const preview = await useCases.previewPublication(id, "", review);
    expect(preview.ok).toBe(false);
    expect(!preview.ok && preview.error.code).toBe("bad-request");
    expect((await useCases.publishReview(id, first("", review))).ok).toBe(false);
  });

  it("only comments when the reviewer wrote the PR", async () => {
    const { useCases, seeded } = setup({ githubUser: smallFeature.pullRequest.author });
    await seeded;
    const preview = await useCases.previewPublication(id, "", raised);
    expect(preview.ok && preview.value.verdict).toBe("comment");
  });

  it("publishes a review once, however often it's asked", async () => {
    const { useCases, github, seeded } = setup();
    await seeded;
    const [one, two] = await Promise.all([
      useCases.publishReview(id, first("", raised)),
      useCases.publishReview(id, first("", raised)),
    ]);
    const three = await useCases.publishReview(id, first("", raised));
    expect(two).toEqual(one);
    expect(three).toEqual(one);
    expect(github.publishAttempts).toHaveLength(1);
  });

  it("publishes another review, with its own verdict, after the first", async () => {
    const { useCases, github, store, seeded } = setup();
    await seeded;
    expect((await useCases.publishReview(id, first("", raised))).ok).toBe(true);
    // The same line again, and the summary: the first review's records don't skip them.
    const again = await useCases.publishReview(id, {
      ...first("Fixed, thanks.", { ...raised, verdict: "approve" }),
      publicationId: secondId,
    });
    expect(again.ok).toBe(true);
    expect(
      github.publishAttempts.map((attempt) => [attempt.publication.verdict, attempt.postedKeys]),
    ).toEqual([
      ["request_changes", ["summary", raisedKey]],
      ["approve", ["summary", raisedKey]],
    ]);
    expect((await store.getPublications(id)).map((stored) => [stored.number, stored.id])).toEqual([
      [1, firstId],
      [2, secondId],
    ]);
    const view = await useCases.getAnalysisView(id);
    expect(view.ok && view.value.publication).toEqual(again.ok && again.value);
  });

  it("publishes two reviews sent at once one after the other", async () => {
    const { useCases, github, store, seeded } = setup();
    await seeded;
    const [one, two] = await Promise.all([
      useCases.publishReview(id, first("", raised)),
      useCases.publishReview(id, { ...first("", approval), publicationId: secondId }),
    ]);
    expect(one.ok && two.ok).toBe(true);
    expect(github.publishAttempts.map((attempt) => attempt.publication.verdict)).toEqual([
      "request_changes",
      "approve",
    ]);
    expect((await store.getPublications(id)).map((stored) => stored.number)).toEqual([1, 2]);
  });

  it("continues a review that failed part-way under another ID, as the same review", async () => {
    const { useCases, github, store, seeded } = setup();
    await seeded;
    expect((await useCases.publishReview(id, first("", raised))).ok).toBe(true);
    github.failPublishAtPost(2, network);
    const second = { ...first("", raised), publicationId: secondId };
    expect((await useCases.publishReview(id, second)).ok).toBe(false);
    // The page lost the ID, say, after a reload: the review it starts is still the second.
    const third = PublicationId.parse("00000000-0000-4000-8000-000000000003");
    expect((await useCases.publishReview(id, { ...second, publicationId: third })).ok).toBe(true);
    expect(github.publishAttempts.map((attempt) => attempt.postedKeys)).toEqual([
      ["summary", raisedKey],
      ["summary"],
      [raisedKey],
    ]);
    expect((await store.getPublications(id)).map((stored) => [stored.number, stored.id])).toEqual([
      [1, firstId],
      [2, third],
    ]);
  });

  it("refuses a review that says nothing", async () => {
    const { useCases, github, seeded } = setup();
    await seeded;
    expect(await useCases.publishReview(id, first("  ", {}))).toEqual(
      err({
        code: "bad-request",
        message: "Nothing to publish: no comment, no summary and no verdict",
      }),
    );
    expect(github.publishAttempts).toEqual([]);
    expect((await useCases.publishReview(id, first("", approval))).ok).toBe(true);
  });

  it("posts only the rest when retried after a partial failure", async () => {
    const { useCases, github, store, seeded } = setup();
    await seeded;
    github.failPublishAtPost(2, network);
    expect(await useCases.publishReview(id, first("", raised))).toEqual(
      err({ code: "host-error", message: "socket hang up" }),
    );
    expect([...(await store.getPostedComments(id, 1)).keys()]).toEqual(["summary"]);
    expect(await store.getPublications(id)).toEqual([]);

    const receipt = await useCases.publishReview(id, first("", raised));
    expect(github.publishAttempts.map((attempt) => attempt.postedKeys)).toEqual([
      ["summary"],
      [raisedKey],
    ]);
    expect(receipt.ok && receipt.value.postedCommentIds).toEqual({
      summary: "fake-comment-1",
      [raisedKey]: "fake-comment-2",
    });
    expect(receipt.ok && Object.keys(receipt.value.postedCommentIds)).toEqual([
      CommentKey.parse("summary"),
      raisedKey,
    ]);
  });

  it("records a line comment the host accepted as a signal, once however the review is retried", async () => {
    const { useCases, github, preferences, seeded } = setup();
    await seeded;
    github.failPublishAtPost(2, network);
    expect((await useCases.publishReview(id, first("Summary.", raised))).ok).toBe(false);
    // The summary went; the line comment didn't, so nothing says what the reviewer looks for yet.
    expect(await preferences.listSignals(10)).toEqual([]);

    expect((await useCases.publishReview(id, first("Summary.", raised))).ok).toBe(true);
    expect((await useCases.publishReview(id, first("Summary.", raised))).ok).toBe(true);

    expect(await preferences.listSignals(10)).toEqual([
      {
        kind: "comment",
        at: "2026-10-21T10:00:00.000Z",
        pullRequest: ref,
        pointKind: null,
        title: "",
        text: "Out of scope.",
        path: commented.path,
      },
    ]);
  });

  it("records a comment on the same line by a later review as a signal of its own", async () => {
    const { useCases, preferences, seeded } = setup();
    await seeded;
    await useCases.publishReview(id, first("", raised));
    const again = {
      ...first("", {
        hunkComments: raised.hunkComments.map((one) => ({ ...one, body: "Still out of scope." })),
      }),
      publicationId: secondId,
    };
    await useCases.publishReview(id, again);

    expect((await preferences.listSignals(10)).map((signal) => signal.text).sort()).toEqual([
      "Out of scope.",
      "Still out of scope.",
    ]);
  });

  it("publishes even when the signal can't be written", async () => {
    const { useCases, store, seeded } = setup({ preferences: new FailingSignals() });
    await seeded;

    expect((await useCases.publishReview(id, first("", raised))).ok).toBe(true);
    expect(await store.getPublications(id)).toHaveLength(1);
  });

  it("refuses a stale analysis unless allowed", async () => {
    const { useCases, github, seeded } = setup();
    await seeded;
    github.setHeadSha(ref, "2".repeat(40));
    expect(await useCases.publishReview(id, first("", approval))).toEqual(
      err({
        code: "stale-analysis",
        message: "The pull request has new commits since this analysis",
      }),
    );
    expect(github.publishAttempts).toEqual([]);
    expect((await useCases.publishReview(id, first("", approval, true))).ok).toBe(true);
    expect(github.publishAttempts[0]?.headSha).toBe(smallFeatureAnalysis.key.headSha);
  });

  it("needs a complete analysis, a configured host and the PR", async () => {
    const incomplete = setup({ analysis: running });
    await incomplete.seeded;
    const notComplete = err({
      code: "analysis-not-complete",
      message: "The analysis isn't complete",
    });
    expect(await incomplete.useCases.previewPublication(id, "")).toEqual(notComplete);
    expect(await incomplete.useCases.publishReview(id, first("", approval))).toEqual(notComplete);

    const hostless = setup({ noHosts: true });
    await hostless.seeded;
    expect(await hostless.useCases.publishReview(id, first("", approval))).toEqual(
      err({ code: "host-not-configured", message: "GitHub isn't configured" }),
    );

    const { useCases, github, seeded } = setup();
    await seeded;
    github.failNext("getPullRequest", network);
    expect(await useCases.publishReview(id, first("", approval))).toEqual(
      err({ code: "host-error", message: "socket hang up" }),
    );
  });
});

describe("revokeApproval", () => {
  const approve = (verdict: PublicationVerdict) => ({
    publicationId: firstId,
    summary: "",
    allowStale: false,
    hunkComments: [],
    verdict,
  });

  it("takes back the reviewer's approval on the host", async () => {
    const { useCases, github, seeded } = setup();
    await seeded;
    expect((await useCases.publishReview(id, approve("approve"))).ok).toBe(true);
    expect(github.approves(ref)).toBe(true);

    expect(await useCases.revokeApproval(id)).toEqual(ok(null));
    expect(github.approves(ref)).toBe(false);
  });

  it("passes on the host's refusal, without retrying it", async () => {
    const { useCases, github, seeded } = setup();
    await seeded;
    github.failNext("revokeApproval", network);
    expect(await useCases.revokeApproval(id)).toEqual(
      err({ code: "host-error", message: "socket hang up" }),
    );
  });

  it("returns not-found for an unknown analysis", async () => {
    const { useCases } = setup();
    expect((await useCases.revokeApproval(missingId)).ok).toBe(false);
  });
});

describe("listPullRequests", () => {
  it("merges every host's PRs, most recently updated first", async () => {
    const { useCases } = setup();
    const list = await useCases.listPullRequests();
    expect(list.errors).toEqual([]);
    expect(list.items.map((item) => item.updatedAt)).toEqual(
      allFixtures
        .map((fixture) => fixture.pullRequest.updatedAt)
        .sort()
        .reverse(),
    );
  });

  it("reports a failing host and keeps the others' PRs", async () => {
    const { useCases, bitbucket } = setup();
    bitbucket.failNext("listPullRequests", network);
    const list = await useCases.listPullRequests();
    expect(list.errors).toEqual([{ host: "bitbucket", message: "socket hang up" }]);
    expect(list.items).toHaveLength(allFixtures.length - 1);
    expect(list.items.map((item) => item.ref.repo.host)).not.toContain("bitbucket");
  });

  it("lists only configured hosts", async () => {
    const { useCases } = setup({ onlyGithub: true });
    const list = await useCases.listPullRequests();
    expect(list.items.map((item) => item.url)).not.toContain(bitbucketBugfix.pullRequest.url);
  });

  it("adds a PR opened here that no host lists, as one to review", async () => {
    const { useCases, github, seeded } = setup();
    await seeded;
    github.unlist(ref);

    const list = await useCases.listPullRequests();

    expect(list.items.filter((item) => item.ref.number === ref.number)).toEqual([
      expect.objectContaining({ ref, role: "reviewer", url: smallFeature.pullRequest.url }),
    ]);
    expect(list.items).toHaveLength(allFixtures.length);
  });

  it("leaves out a PR opened here that has since been merged or closed", async () => {
    const { useCases, github, seeded } = setup();
    await seeded;
    github.close(ref);

    const list = await useCases.listPullRequests();

    expect(list.items.map((item) => item.url)).not.toContain(smallFeature.pullRequest.url);
    expect(github.getOpenPullRequestsCalls).toEqual([[ref]]);
  });

  it("lists a PR the host lists and that was opened here once, with the host's role", async () => {
    const { useCases, seeded } = setup({ githubUser: smallFeature.pullRequest.author });
    await seeded;

    const list = await useCases.listPullRequests();

    expect(list.items.filter((item) => item.url === smallFeature.pullRequest.url)).toEqual([
      expect.objectContaining({ role: "author" }),
    ]);
  });

  it("asks a host only about the PRs opened on it", async () => {
    const { useCases, github, bitbucket, seeded } = setup();
    await seeded;

    await useCases.listPullRequests();

    expect(github.getOpenPullRequestsCalls).toEqual([[ref]]);
    expect(bitbucket.getOpenPullRequestsCalls).toEqual([]);
  });

  it("reports a failed lookup of opened PRs once, keeping what the host lists", async () => {
    const { useCases, github, seeded } = setup();
    await seeded;
    github.unlist(ref);
    github.failNext("getOpenPullRequests", network);

    const list = await useCases.listPullRequests();

    expect(list.errors).toEqual([{ host: "github", message: "socket hang up" }]);
    expect(list.items).toHaveLength(allFixtures.length - 1);
  });

  it("reports a failing host once when its lookup fails too", async () => {
    const { useCases, github, seeded } = setup();
    await seeded;
    github.failNext("listPullRequests", network);
    github.failNext("getOpenPullRequests", { ...network, message: "timed out" });

    const list = await useCases.listPullRequests();

    expect(list.errors).toEqual([{ host: "github", message: "socket hang up" }]);
  });
});

describe("getStatus", () => {
  it("reports each host's user or error, Jira, the model and the version", async () => {
    const { useCases, bitbucket } = setup();
    bitbucket.failNext("currentUser", { ...network, kind: "unauthorized", message: "Bad token" });
    expect(await useCases.getStatus()).toEqual({
      version: "1.2.3",
      hosts: {
        github: { configured: true, user: { id: "lee-park", name: "Lee Park" }, error: null },
        bitbucket: { configured: true, user: null, error: "Bad token" },
      },
      jira: { configured: true },
      model: { options: [fakeModelOption()], defaultId: fakeModelOption().id },
    });
  });

  it("reports unconfigured hosts", async () => {
    const { useCases } = setup({ onlyGithub: true });
    const status = await useCases.getStatus();
    expect(status.hosts.bitbucket).toEqual({ configured: false, user: null, error: null });
  });
});
