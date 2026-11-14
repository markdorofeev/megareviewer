import { describe, expect, it } from "vitest";
import {
  createFixtureFetch,
  describePullRequestStatusContract,
  FixedClock,
  RecordingLogger,
} from "../../application/testing/index.ts";
import type { PullRequestRef } from "../../domain/review/index.ts";
import {
  STATUS_HEAD,
  STATUS_HEAD_WITHOUT_CHECKS,
  statusExchanges,
  statusWithoutChecksExchanges,
} from "./fixtures/status.synthetic.ts";
import unauthorizedExchanges from "./fixtures/unauthorized.synthetic.json" with { type: "json" };
import { createGitHubStatusSource } from "./index.ts";

const pr: PullRequestRef = {
  repo: { host: "github", owner: "sindresorhus", repo: "is" },
  number: 210,
};

const sourceWith = (fetch: typeof globalThis.fetch, logger = new RecordingLogger()) =>
  createGitHubStatusSource({
    token: "test-token",
    version: "test",
    clock: new FixedClock(),
    logger,
    fetch,
  });

describePullRequestStatusContract("github", () => ({
  source: () => sourceWith(createFixtureFetch(statusExchanges)),
  sourceWithoutChecks: () => sourceWith(createFixtureFetch(statusWithoutChecksExchanges)),
  pr,
  head: STATUS_HEAD,
  headWithoutChecks: STATUS_HEAD_WITHOUT_CHECKS,
  state: "open",
  authorId: "sindresorhus",
  reviewers: [
    { id: "lee-park", verdict: null },
    { id: "team:maintainers", verdict: null },
    { id: "jk-ortiz", verdict: "changes-requested" },
    { id: "ana-silva", verdict: "commented" },
    { id: "ruth-ng", verdict: "approved" },
  ],
  checkNames: ["test (22)", "test (24)", "lint", "deploy-preview", "codecov/patch"],
  missing: { ...pr, number: 999999 },
}));

describe("createGitHubStatusSource", () => {
  it("maps each check's state, and keeps only http(s) links", async () => {
    const result = await sourceWith(createFixtureFetch(statusExchanges)).getStatus(pr, STATUS_HEAD);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.checks).toEqual([
      {
        name: "test (22)",
        state: "passed",
        url: "https://github.com/sindresorhus/is/actions/runs/1/job/1",
      },
      {
        name: "test (24)",
        state: "failed",
        url: "https://github.com/sindresorhus/is/actions/runs/1/job/2",
      },
      { name: "lint", state: "running", url: null },
      { name: "deploy-preview", state: "skipped", url: null },
      {
        name: "codecov/patch",
        state: "passed",
        url: "https://app.codecov.io/gh/sindresorhus/is/pull/210",
      },
    ]);
  });

  it("takes GitHub's review decision, names a team, and falls back to a login", async () => {
    const result = await sourceWith(createFixtureFetch(statusExchanges)).getStatus(pr, STATUS_HEAD);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.reviewStatus).toBe("changes-requested");
    expect(result.value.reviewers).toContainEqual({
      id: "team:maintainers",
      name: "Maintainers",
      team: true,
      verdict: null,
    });
    expect(result.value.reviewers).toContainEqual({
      id: "ana-silva",
      name: "ana-silva",
      team: false,
      verdict: "commented",
    });
  });

  it("fails as unauthorized when the token is rejected", async () => {
    const result = await sourceWith(createFixtureFetch(unauthorizedExchanges)).getStatus(
      pr,
      STATUS_HEAD,
    );
    expect(!result.ok && result.error.kind).toBe("unauthorized");
  });
});
