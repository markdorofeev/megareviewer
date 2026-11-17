import type { PullRequestFixture } from "../../../src/application/testing/index.ts";
import { fixtureFromFiles } from "../../case-files.ts";
import type { CaseGuidance } from "../../guidance.ts";

// The tenant condition stayed inside the status branch when the status became optional, so the
// new All tab lists every tenant's tickets; the tests assert the tenant only where a status is set.
export const fixture: PullRequestFixture = fixtureFromFiles(new URL(".", import.meta.url), {
  name: "preference-look-for",
  pullRequest: {
    ref: { repo: { host: "github", owner: "acme", repo: "helpdesk" }, number: 412 },
    url: "https://github.com/acme/helpdesk/pull/412",
    title: "Filter tickets by assignee, and list every status",
    description:
      "The ticket list showed one status at a time and couldn't be narrowed to one agent. `GET /tickets` now takes an optional `assignee`, and `status` is optional too: without it the list has tickets of every status, for the new All tab.\n\n`listTickets` takes a filter and builds its WHERE clause from the parts that are set.",
    author: { id: "noor-haddad", name: "Noor Haddad" },
    sourceBranch: "feature/ticket-filters",
    targetBranch: "main",
    baseSha: "3b1f0a7c5d9e2468ace0b1d3f5a7c9e1b3d5f7a9",
    headSha: "c4e6a8b0d2f41357b9d1f3a5c7e9b1d3f5a7c9e0",
    commits: [
      {
        sha: "c4e6a8b0d2f41357b9d1f3a5c7e9b1d3f5a7c9e0",
        message: "Filter the ticket list by assignee and make the status optional",
        author: "Noor Haddad",
      },
    ],
    createdAt: "2026-11-16T13:00:00Z",
    updatedAt: "2026-11-16T13:40:00Z",
  },
  tickets: [],
});

export const guidance: CaseGuidance = {
  preferences: [
    {
      kind: "look-for",
      text: "Tenant isolation: every query on a tenant's data filters by tenant ID",
      scope: "global",
    },
  ],
  guidelines: [],
};
