import type { PullRequestFixture } from "../../../src/application/testing/index.ts";
import { fixtureFromFiles } from "../../case-files.ts";
import type { CaseGuidance } from "../../guidance.ts";
import { EVENTS_RULES, HANDBOOK } from "./handbook.ts";

// The event's name has no version, which only the Events section of a handbook of more than 100 KB
// asks for: nothing in the PR, in CLAUDE.md or in the file it imports says how events are named.
export const fixture: PullRequestFixture = fixtureFromFiles(new URL(".", import.meta.url), {
  name: "linked-section",
  pullRequest: {
    ref: { repo: { host: "github", owner: "acme", repo: "billing" }, number: 640 },
    url: "https://github.com/acme/billing/pull/640",
    title: "Tell subscribers when an invoice is voided",
    description:
      "Subscribers learn that an invoice was voided when they next load it, which for some is at the end of the month. Voiding one now publishes an event with the invoice, its account and when it was voided.",
    author: { id: "marta-silva", name: "Marta Silva" },
    sourceBranch: "feature/invoice-voided-event",
    targetBranch: "main",
    baseSha: "4d6f8a0c2e4b6d8f0a1c3e5b7d9f1a3c5e7092b4",
    headSha: "9a1c3e5b7d9f0b2d4f6a8c0e2b4d6f8a0c1e3b5d",
    commits: [
      {
        sha: "9a1c3e5b7d9f0b2d4f6a8c0e2b4d6f8a0c1e3b5d",
        message: "Publish an event when an invoice is voided",
        author: "Marta Silva",
      },
    ],
    createdAt: "2026-11-25T10:00:00Z",
    updatedAt: "2026-11-25T10:15:00Z",
  },
  tickets: [],
});

const CLAUDE_MD = `# billing

The service behind invoices and payments.

@docs/house-rules.md

How each part works, and the rules it keeps, is in the [handbook](docs/handbook.md). To run it on your machine, see [local setup](docs/local-setup.md).
`;

const HOUSE_RULES_MD = `# House rules

- **No SQL in request handlers.** A handler calls a function in a \`repository.ts\`; queries live there.
- **Errors go through \`sendError\`,** with a snake_case code.
- **A query on an account's data** takes the account ID from the session, never from the request body.
`;

const LOCAL_SETUP_MD = `# Local setup

Run \`pnpm db:up\`, then \`pnpm dev\`. The seed has one account with a paid, an open and a voided invoice.
`;

export const guidance: CaseGuidance = {
  preferences: [],
  guidelines: [{ path: "CLAUDE.md", content: CLAUDE_MD }],
  imported: [{ path: "docs/house-rules.md", content: HOUSE_RULES_MD }],
  linked: [
    { path: "docs/handbook.md", content: HANDBOOK, rule: EVENTS_RULES },
    { path: "docs/local-setup.md", content: LOCAL_SETUP_MD },
  ],
};
