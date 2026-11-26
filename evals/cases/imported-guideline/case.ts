import type { PullRequestFixture } from "../../../src/application/testing/index.ts";
import { fixtureFromFiles } from "../../case-files.ts";
import type { CaseGuidance } from "../../guidance.ts";

// The handler removes someone's access without recording it, which only docs/service-rules.md,
// a file CLAUDE.md imports, asks for: nothing in the PR or in CLAUDE.md names an audit log.
export const fixture: PullRequestFixture = fixtureFromFiles(new URL(".", import.meta.url), {
  name: "imported-guideline",
  pullRequest: {
    ref: { repo: { host: "github", owner: "acme", repo: "projects" }, number: 231 },
    url: "https://github.com/acme/projects/pull/231",
    title: "Remove a member from a project",
    description:
      "A project's members can be listed but not removed, so someone who leaves a team keeps their access until support takes it away. `DELETE /projects/:id/members/:memberId` removes a member. Only someone who administers the project can call it, and an owner can't be removed.\n\nThe members page calls it in the next PR.",
    author: { id: "lena-fischer", name: "Lena Fischer" },
    sourceBranch: "feature/remove-member",
    targetBranch: "main",
    baseSha: "2c4e6a8b0d1f3a5c7e9b1d3f5a7c9e0b2d4f6a8c",
    headSha: "b7d9f1a3c5e7092b4d6f8a0c2e4b6d8f0a1c3e5b",
    commits: [
      {
        sha: "b7d9f1a3c5e7092b4d6f8a0c2e4b6d8f0a1c3e5b",
        message: "Add the endpoint that removes a project member",
        author: "Lena Fischer",
      },
    ],
    createdAt: "2026-11-25T09:00:00Z",
    updatedAt: "2026-11-25T09:20:00Z",
  },
  tickets: [],
});

const CLAUDE_MD = `# projects

The service behind projects and who can see them. Follow the rules below on every change.

@docs/service-rules.md
@docs/local-setup.md
`;

const SERVICE_RULES_MD = `# Service rules

- **No SQL in request handlers.** A handler calls a function in a \`repository.ts\`; queries live there.
- **Errors go through \`sendError\`,** with a snake_case code. A project the caller can't see answers 404, never 403.
- **Changes to access are recorded.** A handler that gives, changes or takes away someone's access to a project calls \`recordAccess(req, action, memberId)\` from \`src/access-log.ts\` before it answers. Compliance reads that log, and support answers "who removed me?" from it.
- **Lists are ordered.** A query that returns several rows has an ORDER BY with a unique last column.
`;

const LOCAL_SETUP_MD = `# Running it locally

Run \`pnpm db:up\` and then \`pnpm dev\`. The seed has one project with an owner, an editor and a viewer.
`;

export const guidance: CaseGuidance = {
  preferences: [],
  guidelines: [{ path: "CLAUDE.md", content: CLAUDE_MD }],
  imported: [
    { path: "docs/service-rules.md", content: SERVICE_RULES_MD },
    { path: "docs/local-setup.md", content: LOCAL_SETUP_MD },
  ],
};
