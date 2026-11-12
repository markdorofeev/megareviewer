import { describe, expect, it } from "vitest";
import {
  type Analysis,
  AnalysisId,
  buildPublication,
  CommentKey,
  DecisionId,
  type HostError,
  type HostUser,
} from "../../domain/review/index.ts";
import { err, ok } from "../../domain/shared/index.ts";
import { createAnalysisEvents } from "../events/index.ts";
import {
  allFixtures,
  bitbucketBugfix,
  FakeAnalysisModel,
  FakeCodeParser,
  FakeGitHost,
  FakeLocalCheckouts,
  FakeTicketSource,
  FixedClock,
  InMemoryAnalysisStore,
  InMemoryFileCache,
  RecordingLogger,
  smallFeature,
  smallFeatureAnalysis,
} from "../testing/index.ts";
import { createUseCases } from "./index.ts";

const d = DecisionId.parse;
const { id } = smallFeatureAnalysis;
const { ref } = smallFeature.pullRequest;
const missingId = AnalysisId.parse("a_0000000000000000");
const network: HostError = { kind: "network", message: "socket hang up", retryAfterSeconds: null };

const setup = (
  options: {
    githubUser?: HostUser;
    onlyGithub?: boolean;
    noHosts?: boolean;
    analysis?: Analysis;
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
  const tickets = new FakeTicketSource();
  const useCases = createUseCases(
    {
      hosts: options.noHosts ? {} : options.onlyGithub ? { github } : { github, bitbucket },
      tickets,
      model: new FakeAnalysisModel(),
      modelEnabled: false,
      store,
      fileCache: new InMemoryFileCache(),
      checkouts: new FakeLocalCheckouts(),
      threads: {},
      parser: new FakeCodeParser(),
      events: createAnalysisEvents(),
      clock,
      logger: new RecordingLogger(),
    },
    { version: "1.2.3" },
  );
  const seeded = store.saveAnalysis(options.analysis ?? smallFeatureAnalysis);
  return { clock, github, bitbucket, store, useCases, seeded };
};

const running: Analysis = { ...smallFeatureAnalysis, status: "running" };

describe("getAnalysisView", () => {
  it("returns the analysis with its verdicts and publication", async () => {
    const { useCases, store, seeded } = setup();
    await seeded;
    const verdict = {
      decisionId: d("d1"),
      verdict: "approved" as const,
      comment: "",
      updatedAt: "2026-10-21T10:00:00Z",
    };
    await store.saveVerdict(id, verdict);
    expect(await useCases.getAnalysisView(id)).toEqual(
      ok({
        analysis: smallFeatureAnalysis,
        verdicts: [verdict],
        publication: null,
        isAuthor: false,
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

  it("knows when the current user wrote the PR", async () => {
    const { useCases, seeded } = setup({ githubUser: smallFeature.pullRequest.author });
    await seeded;
    const view = await useCases.getAnalysisView(id);
    expect(view.ok && view.value.isAuthor).toBe(true);
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

describe("recordVerdict", () => {
  it("saves the verdict with the current time", async () => {
    const { useCases, store, seeded } = setup();
    await seeded;
    const saved = await useCases.recordVerdict(id, d("d2"), "rejected", "Needs eviction.");
    const expected = {
      decisionId: d("d2"),
      verdict: "rejected",
      comment: "Needs eviction.",
      updatedAt: "2026-10-21T10:00:00.000Z",
    };
    expect(saved).toEqual(ok(expected));
    expect(await store.getVerdicts(id)).toEqual([expected]);
  });

  it("needs a complete analysis and a known decision", async () => {
    const { useCases, seeded } = setup();
    await seeded;
    expect(await useCases.recordVerdict(id, d("d9"), "approved", "")).toEqual(
      err({ code: "not-found", message: `No decision d9 in analysis ${id}` }),
    );
    expect(await useCases.recordVerdict(missingId, d("d1"), "approved", "")).toEqual(
      err({ code: "not-found", message: `No analysis ${missingId}` }),
    );
    const incomplete = setup({ analysis: running });
    await incomplete.seeded;
    expect(await incomplete.useCases.recordVerdict(id, d("d1"), "approved", "")).toEqual(
      err({ code: "analysis-not-complete", message: "The analysis isn't complete" }),
    );
  });
});

describe("publishing", () => {
  const reject = async (useCases: ReturnType<typeof setup>["useCases"]) => {
    await useCases.recordVerdict(id, d("d1"), "approved", "");
    await useCases.recordVerdict(id, d("d3"), "rejected", "Out of scope here.");
  };

  it("previews exactly what it publishes", async () => {
    const { useCases, github, store, seeded } = setup();
    await seeded;
    await reject(useCases);
    const preview = await useCases.previewPublication(id, "Drop the rate limit.");
    expect(preview).toEqual(
      ok(
        buildPublication({
          analysis: smallFeatureAnalysis,
          verdicts: await store.getVerdicts(id),
          summary: "Drop the rate limit.",
          isAuthor: false,
        }),
      ),
    );
    const receipt = await useCases.publishReview(id, "Drop the rate limit.", false);
    expect(receipt.ok).toBe(true);
    expect(github.publishAttempts).toHaveLength(1);
    expect(github.publishAttempts[0]?.publication).toEqual(preview.ok && preview.value);
    expect(github.publishAttempts[0]?.headSha).toBe(smallFeatureAnalysis.key.headSha);
    expect(await store.getPublication(id)).toEqual(receipt.ok && receipt.value);
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
    expect((await useCases.publishReview(id, "", false, review)).ok).toBe(false);
    expect((await useCases.publishReview(id, "", false, review)).ok).toBe(true);
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
    expect((await useCases.publishReview(id, "", false, review)).ok).toBe(false);
  });

  it("only comments when the reviewer wrote the PR", async () => {
    const { useCases, seeded } = setup({ githubUser: smallFeature.pullRequest.author });
    await seeded;
    await reject(useCases);
    const preview = await useCases.previewPublication(id, "");
    expect(preview.ok && preview.value.verdict).toBe("comment");
  });

  it("publishes once, however often it's asked", async () => {
    const { useCases, github, seeded } = setup();
    await seeded;
    await reject(useCases);
    const [first, second] = await Promise.all([
      useCases.publishReview(id, "", false),
      useCases.publishReview(id, "", false),
    ]);
    const third = await useCases.publishReview(id, "", false);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(github.publishAttempts).toHaveLength(1);
  });

  it("posts only the rest when retried after a partial failure", async () => {
    const { useCases, github, store, seeded } = setup();
    await seeded;
    await reject(useCases);
    github.failPublishAtPost(2, network);
    expect(await useCases.publishReview(id, "", false)).toEqual(
      err({ code: "host-error", message: "socket hang up" }),
    );
    expect([...(await store.getPostedComments(id)).keys()]).toEqual(["summary"]);
    expect(await store.getPublication(id)).toBeNull();

    const receipt = await useCases.publishReview(id, "", false);
    expect(github.publishAttempts.map((attempt) => attempt.postedKeys)).toEqual([
      ["summary"],
      ["decision:d3"],
    ]);
    expect(receipt.ok && receipt.value.postedCommentIds).toEqual({
      summary: "fake-comment-1",
      "decision:d3": "fake-comment-2",
    });
    expect(receipt.ok && Object.keys(receipt.value.postedCommentIds)).toEqual([
      CommentKey.parse("summary"),
      CommentKey.parse("decision:d3"),
    ]);
  });

  it("refuses a stale analysis unless allowed", async () => {
    const { useCases, github, seeded } = setup();
    await seeded;
    github.setHeadSha(ref, "2".repeat(40));
    expect(await useCases.publishReview(id, "", false)).toEqual(
      err({
        code: "stale-analysis",
        message: "The pull request has new commits since this analysis",
      }),
    );
    expect(github.publishAttempts).toEqual([]);
    expect((await useCases.publishReview(id, "", true)).ok).toBe(true);
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
    expect(await incomplete.useCases.publishReview(id, "", false)).toEqual(notComplete);

    const hostless = setup({ noHosts: true });
    await hostless.seeded;
    expect(await hostless.useCases.publishReview(id, "", false)).toEqual(
      err({ code: "host-not-configured", message: "GitHub isn't configured" }),
    );

    const { useCases, github, seeded } = setup();
    await seeded;
    github.failNext("getPullRequest", network);
    expect(await useCases.publishReview(id, "", false)).toEqual(
      err({ code: "host-error", message: "socket hang up" }),
    );
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
      model: { enabled: false },
    });
  });

  it("reports unconfigured hosts", async () => {
    const { useCases } = setup({ onlyGithub: true });
    const status = await useCases.getStatus();
    expect(status.hosts.bitbucket).toEqual({ configured: false, user: null, error: null });
  });
});
