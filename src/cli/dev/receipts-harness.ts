import {
  FakeHarnessSource,
  type PullRequestFixture,
  smallFeature,
} from "../../application/testing/index.ts";
import { type HostKind, pullRequestUrl } from "../../domain/review/index.ts";

const repo = { ...smallFeature.pullRequest.ref.repo, repo: "warehouse" };
const ref = { repo, number: 8 };

const HARNESS_FILES = {
  "REVIEW.md": `# Reviewing warehouse

- A change to what a customer is charged names the test that checks it.
- Follow docs/house-rules.md.
`,
  "CLAUDE.md": `# Working on warehouse

@docs/house-rules.md
@docs/architecture.md

How tests are written is in docs/testing.md. When something breaks in production, start at the
[runbooks](docs/runbooks/README.md). What changed and when is in the [changelog](docs/changelog.md).
`,
  "docs/house-rules.md": `# House rules

@naming.md

## Services

- Route handlers are thin: the logic is in a service.

## Caches

- A cache says what invalidates it.
`,
  "docs/naming.md": "# Naming\n\n- A function is named for what it returns.\n",
  // Over what's put in a prompt, so it's read on request.
  "docs/architecture.md": `# Architecture\n\n## Services\n\n${"- Each service owns its tables, and no other service reads them.\n".repeat(1100)}`,
  "docs/testing.md": "# Testing\n\n- A test of a rule names the rule.\n",
  "docs/runbooks/README.md": "# Runbooks\n\n- [Refunds](refunds.md)\n- [Stock](stock.md)\n",
  "docs/runbooks/refunds.md":
    "# Refunds\n\nA refund is retried three times. See [stock](stock.md).\n",
  "docs/runbooks/stock.md": "# Stock\n\nStock is counted every night.\n",
};

/**
 * small-feature in a repository of its own, on the fake server only, whose guideline files import,
 * link and mention others.
 */
export const receiptsHarness: PullRequestFixture = {
  ...smallFeature,
  name: "receipts-harness",
  pullRequest: {
    ...smallFeature.pullRequest,
    ref,
    url: pullRequestUrl(ref),
    title: `${smallFeature.pullRequest.title}, with a harness`,
  },
  baseFiles: { ...smallFeature.baseFiles, ...HARNESS_FILES },
};

/**
 * Each host's harness source over the fixtures' base files, GitHub's listing them and Bitbucket's
 * saying what changed, as the real hosts'.
 */
export const fakeHarnessSources = (
  fixtures: readonly PullRequestFixture[],
): Record<HostKind, FakeHarnessSource> => {
  const sources = {
    github: new FakeHarnessSource({ host: "github", diffs: false }),
    bitbucket: new FakeHarnessSource({ host: "bitbucket", lists: false }),
  };
  for (const { pullRequest, baseFiles } of fixtures) {
    const { repo: of } = pullRequest.ref;
    sources[of.host].setFiles(of, pullRequest.baseSha, baseFiles);
  }
  sources.github.setFiles(repo, receiptsHarness.pullRequest.baseSha, {
    "docs/changelog.md": { kind: "skipped", reason: "too-large" },
  });
  return sources;
};
