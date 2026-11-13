import { beforeEach, describe, expect, it } from "vitest";
import {
  CommentKey,
  HostUser,
  type Publication,
  PublicationReceipt,
  PullRequest,
  type PullRequestRef,
  PullRequestSummary,
  type RepoRef,
} from "../../../domain/review/index.ts";
import type { GitHost, PublishOptions } from "../../ports/index.ts";

export interface GitHostContractSetup {
  host(scenario: "ok" | "unauthorized" | "rate-limited"): GitHost;
  /** A PR that exists and is merged. */
  existingPr: PullRequestRef;
  missingPr: PullRequestRef;
  existingFile: { repo: RepoRef; sha: string; path: string };
  missingFile: { repo: RepoRef; sha: string; path: string };
  /** A PR with headSha, where every comment of `publication` anchors on a line in the diff. */
  publishablePr: { ref: PullRequestRef; headSha: string };
  publication: Publication;
}

const recordingOptions = (
  headSha: string,
  alreadyPosted: readonly CommentKey[] = [],
): PublishOptions & { posted: [CommentKey, string][] } => {
  const posted: [CommentKey, string][] = [];
  return {
    headSha,
    alreadyPosted: new Set(alreadyPosted),
    onPosted: async (key, hostCommentId) => {
      posted.push([key, hostCommentId]);
    },
    posted,
  };
};

export const describeGitHostContract = (name: string, setup: () => GitHostContractSetup): void => {
  describe(`GitHost contract: ${name}`, () => {
    let s: GitHostContractSetup;
    beforeEach(() => {
      s = setup();
    });

    it("returns the current user", async () => {
      const result = await s.host("ok").currentUser();
      if (!result.ok) throw new Error(`currentUser failed: ${result.error.message}`);
      expect(HostUser.parse(result.value)).toEqual(result.value);
    });

    it("gets an existing PR in domain shape", async () => {
      const result = await s.host("ok").getPullRequest(s.existingPr);
      if (!result.ok) throw new Error(`getPullRequest failed: ${result.error.message}`);
      const pullRequest = result.value;

      expect(PullRequest.parse(pullRequest)).toEqual(pullRequest);
      expect(pullRequest.ref).toEqual(s.existingPr);
      expect(pullRequest.baseSha).toMatch(/^[0-9a-f]{40}$/);
      expect(pullRequest.headSha).toMatch(/^[0-9a-f]{40}$/);
      expect(pullRequest.baseSha).not.toBe(pullRequest.headSha);
      expect(pullRequest.diff).not.toBe("");
    });

    it("returns not-found for a missing PR", async () => {
      const result = await s.host("ok").getPullRequest(s.missingPr);
      expect(!result.ok && result.error.kind).toBe("not-found");
    });

    it("returns files' contents at commits, in the order asked, with null for a missing one", async () => {
      const existing = { sha: s.existingFile.sha, path: s.existingFile.path };
      const missing = { sha: s.missingFile.sha, path: s.missingFile.path };
      const result = await s.host("ok").getFiles(s.existingFile.repo, [missing, existing]);
      if (!result.ok) throw new Error(`getFiles failed: ${result.error.message}`);

      expect(result.value).toHaveLength(2);
      expect(result.value[0]).toBeNull();
      expect(typeof result.value[1]).toBe("string");
    });

    it("returns no contents for no files", async () => {
      expect(await s.host("ok").getFiles(s.existingFile.repo, [])).toEqual({ ok: true, value: [] });
    });

    it("lists PRs as valid summaries", async () => {
      const host = s.host("ok");
      const result = await host.listPullRequests();
      if (!result.ok) throw new Error(`listPullRequests failed: ${result.error.message}`);

      for (const summary of result.value) {
        expect(PullRequestSummary.parse(summary)).toEqual(summary);
        expect(summary.ref.repo.host).toBe(host.host);
      }
    });

    it("leaves merged and missing PRs out of the open ones", async () => {
      const result = await s.host("ok").getOpenPullRequests([s.existingPr, s.missingPr]);
      expect(result).toEqual({ ok: true, value: [] });
    });

    it("finds no open PRs among none", async () => {
      expect(await s.host("ok").getOpenPullRequests([])).toEqual({ ok: true, value: [] });
    });

    it("publishes, calling onPosted once per posted key", async () => {
      const options = recordingOptions(s.publishablePr.headSha);
      const result = await s.host("ok").publish(s.publishablePr.ref, s.publication, options);
      if (!result.ok) throw new Error(`publish failed: ${result.error.message}`);

      const expectedKeys = ["summary", ...s.publication.comments.map((comment) => comment.key)];
      expect(options.posted.map(([key]) => key).sort()).toEqual(expectedKeys.sort());
      expect(PublicationReceipt.parse(result.value)).toEqual(result.value);
      expect(result.value.postedCommentIds).toEqual(Object.fromEntries(options.posted));
    });

    it("skips keys already posted", async () => {
      const skipped = s.publication.comments[0]?.key ?? CommentKey.parse("summary");
      const options = recordingOptions(s.publishablePr.headSha, [skipped]);
      const result = await s.host("ok").publish(s.publishablePr.ref, s.publication, options);

      expect(result.ok).toBe(true);
      expect(options.posted.map(([key]) => key)).not.toContain(skipped);
      expect(result.ok && Object.keys(result.value.postedCommentIds)).not.toContain(skipped);
    });

    it("returns unauthorized from every method when the credentials are rejected", async () => {
      const host = s.host("unauthorized");
      const options = recordingOptions(s.publishablePr.headSha);
      const results = [
        await host.currentUser(),
        await host.getPullRequest(s.existingPr),
        await host.getFiles(s.existingFile.repo, [
          { sha: s.existingFile.sha, path: s.existingFile.path },
        ]),
        await host.listPullRequests(),
        await host.getOpenPullRequests([s.existingPr]),
        await host.publish(s.publishablePr.ref, s.publication, options),
      ];

      expect(results.map((result) => !result.ok && result.error.kind)).toEqual(
        results.map(() => "unauthorized"),
      );
      expect(options.posted).toEqual([]);
    });

    it("returns rate-limited with a retry delay", async () => {
      const result = await s.host("rate-limited").getPullRequest(s.existingPr);
      if (result.ok) throw new Error("expected rate-limited");

      expect(result.error.kind).toBe("rate-limited");
      expect(result.error.retryAfterSeconds).toBeGreaterThanOrEqual(0);
    });
  });
};
