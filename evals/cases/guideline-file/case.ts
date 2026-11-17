import type { PullRequestFixture } from "../../../src/application/testing/index.ts";
import { fixtureFromFiles } from "../../case-files.ts";
import type { CaseGuidance } from "../../guidance.ts";

// The migration has an up section and no down, which only the repository's REVIEW.md asks for:
// nothing in the PR says migrations here have one.
export const fixture: PullRequestFixture = fixtureFromFiles(new URL(".", import.meta.url), {
  name: "guideline-file",
  pullRequest: {
    ref: { repo: { host: "github", owner: "acme", repo: "subscriptions" }, number: 57 },
    url: "https://github.com/acme/subscriptions/pull/57",
    title: "Pause a subscription",
    description:
      "Customers who want a break cancel today, and most don't come back. This adds pausing: `POST /subscriptions/:id/pause` records when a subscription was paused, in a new `paused_at` column.\n\nResuming, and skipping paused subscriptions at renewal, are the next two PRs.",
    author: { id: "ines-okafor", name: "Ines Okafor" },
    sourceBranch: "feature/pause-subscription",
    targetBranch: "main",
    baseSha: "6a8c0e2f4b6d8f0a2c4e6b8d0f2a4c6e8b0d2f4a",
    headSha: "f5d3b1a9c7e5f3d1b9a7c5e3f1d9b7a5c3e1f9d7",
    commits: [
      {
        sha: "f5d3b1a9c7e5f3d1b9a7c5e3f1d9b7a5c3e1f9d7",
        message: "Add paused_at and the endpoint that sets it",
        author: "Ines Okafor",
      },
    ],
    createdAt: "2026-11-17T08:30:00Z",
    updatedAt: "2026-11-17T08:55:00Z",
  },
  tickets: [],
});

const REVIEW_MD = `# Review guidelines

What a reviewer checks on every pull request to this service, beyond whether the code works.

- **Migrations are reversible.** Every file in \`migrations/\` has an \`-- up\` and a \`-- down\` section, and the down section undoes the up. A migration that can't be undone says why in the PR description.
- **No SQL in request handlers.** A handler calls a function in a \`repository.ts\`; queries live there.
- **Queries are scoped to the account.** A query on an account's data takes the account ID from the session, never from the request body.
- **Errors go through \`sendError\`.** Clients get \`{ error: { code, message } }\`, with a code from \`src/errors.ts\`.
`;

export const guidance: CaseGuidance = {
  preferences: [],
  guidelines: [{ path: "REVIEW.md", content: REVIEW_MD }],
};
