import type { ThreadList } from "../../../src/domain/review/index.ts";

const head = "9e8d7c6b5a49382716051f2e3d4c5b6a79881726";
const sam = { id: "sam-rivera", name: "Sam Rivera" };
const lee = { id: "lee-park", name: "Lee Park" };
const all = { reply: true, resolve: true };

/** The mock PR's conversation: open, resolved, a suggestion, and one on lines the diff doesn't show. */
export const fixtureThreads: ThreadList = {
  canApply: true,
  threads: [
    {
      id: "PRRT_tax",
      path: "src/services/receipts.ts",
      side: "new",
      line: 32,
      startLine: null,
      originalLine: 32,
      resolved: false,
      resolvedBy: null,
      outdated: false,
      can: all,
      comments: [
        {
          id: "PRRC_tax1",
          author: lee,
          body: "**major:** This retries with no backoff, so a tax service that's down gets three calls in a row.",
          createdAt: "2026-10-20T09:00:00Z",
          originalCommit: head,
        },
        {
          id: "PRRC_tax2",
          author: sam,
          body: "It's an internal service and fails fast. Is `setTimeout` between attempts enough?",
          createdAt: "2026-10-20T10:00:00Z",
          originalCommit: head,
        },
      ],
    },
    {
      id: "PRRT_attempts",
      path: "src/services/receipts.ts",
      side: "new",
      line: 29,
      startLine: null,
      originalLine: 29,
      resolved: false,
      resolvedBy: null,
      outdated: false,
      can: all,
      comments: [
        {
          id: "PRRC_attempts1",
          author: lee,
          body: "**minor:** Name says what it counts.\n\n```suggestion\nconst MAX_TAX_ATTEMPTS = 3;\n```",
          createdAt: "2026-10-20T09:05:00Z",
          originalCommit: head,
        },
      ],
    },
    {
      id: "PRRT_money",
      path: "src/lib/money.ts",
      side: "new",
      line: 2,
      startLine: null,
      originalLine: 2,
      resolved: true,
      resolvedBy: sam,
      outdated: false,
      can: all,
      comments: [
        {
          id: "PRRC_money1",
          author: lee,
          body: "Rounds half-cents up?",
          createdAt: "2026-10-20T09:10:00Z",
          originalCommit: head,
        },
      ],
    },
    {
      id: "PRRT_earlier",
      path: "src/routes/orders.ts",
      side: "new",
      line: 60,
      startLine: null,
      originalLine: 58,
      resolved: false,
      resolvedBy: null,
      outdated: true,
      can: all,
      comments: [
        {
          id: "PRRC_earlier1",
          author: lee,
          body: "Return a 404 here too.",
          createdAt: "2026-10-19T15:00:00Z",
          originalCommit: head,
        },
      ],
    },
  ],
};
