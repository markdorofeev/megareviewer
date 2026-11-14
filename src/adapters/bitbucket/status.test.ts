import { describe, expect, it } from "vitest";
import {
  createFixtureFetch,
  describePullRequestStatusContract,
  RecordingLogger,
} from "../../application/testing/index.ts";
import type { PullRequestRef } from "../../domain/review/index.ts";
import {
  AUTHOR,
  BITBUCKET_HEAD_WITHOUT_CHECKS,
  BITBUCKET_STATUS_HEAD,
  bitbucketStatusExchanges,
  bitbucketStatusWithoutChecksExchanges,
} from "./fixtures/status.synthetic.ts";
import { createBitbucketStatusSource } from "./index.ts";

const pr: PullRequestRef = {
  repo: { host: "bitbucket", owner: "atlassian", repo: "bitbucket-upload-file" },
  number: 26,
};

const sourceWith = (fetch: typeof globalThis.fetch) =>
  createBitbucketStatusSource({
    username: "lee",
    password: "token",
    logger: new RecordingLogger(),
    fetch,
  });

describePullRequestStatusContract("bitbucket", () => ({
  source: () => sourceWith(createFixtureFetch(bitbucketStatusExchanges)),
  sourceWithoutChecks: () => sourceWith(createFixtureFetch(bitbucketStatusWithoutChecksExchanges)),
  pr,
  head: BITBUCKET_STATUS_HEAD,
  headWithoutChecks: BITBUCKET_HEAD_WITHOUT_CHECKS,
  state: "open",
  authorId: AUTHOR.uuid,
  reviewers: [
    { id: "{9b6f3c2e-1a4d-4c8b-8e2f-7d5a0c9b3e14}", verdict: null },
    { id: "{1e2f3a4b-5c6d-4e7f-8a9b-0c1d2e3f4a5b}", verdict: "changes-requested" },
    { id: "{2f3a4b5c-6d7e-4f8a-9b0c-1d2e3f4a5b6c}", verdict: "approved" },
    { id: "{0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f}", verdict: "commented" },
  ],
  checkNames: ["Pipeline #41 for main", "lint", "Deploy", "End to end"],
  missing: { ...pr, number: 999999 },
}));

describe("createBitbucketStatusSource", () => {
  it("derives the review status, maps build states and keeps only http(s) links", async () => {
    const result = await sourceWith(createFixtureFetch(bitbucketStatusExchanges)).getStatus(
      pr,
      BITBUCKET_STATUS_HEAD,
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.reviewStatus).toBe("changes-requested");
    expect(result.value.checks?.map(({ state, url }) => ({ state, url }))).toEqual([
      {
        state: "passed",
        url: "https://bitbucket.org/atlassian/bitbucket-upload-file/pipelines/results/41",
      },
      { state: "failed", url: "https://ci.example.com/lint/7" },
      { state: "running", url: "https://ci.example.com/deploy/3" },
      { state: "failed", url: null },
    ]);
  });

  it("fails whole when the build statuses fail on the network, so the read is retried", async () => {
    const fixtures = createFixtureFetch(bitbucketStatusExchanges);
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (new Request(input, init).url.includes("/statuses")) throw new TypeError("fetch failed");
      return fixtures(input, init);
    };
    const result = await sourceWith(fetch).getStatus(pr, BITBUCKET_STATUS_HEAD);
    expect(!result.ok && result.error.kind).toBe("network");
  });
});
