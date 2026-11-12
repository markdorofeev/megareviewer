import type { ReviewThread, ThreadList } from "../../../domain/review/index.ts";
import { smallFeature } from "./small-feature.ts";

const { headSha } = smallFeature.pullRequest;
const dana = { id: "dana-kim", name: "Dana Kim" };
const sam = { id: "sam-ortiz", name: "Sam Ortiz" };
const all = { reply: true, resolve: true };

/** small-feature's conversation: every state a thread can be in, on lines the diff shows or not. */
export const smallFeatureThreads: readonly ReviewThread[] = [
  {
    id: "PRRT_cache",
    path: "src/services/receipts.ts",
    side: "new",
    line: 4,
    startLine: null,
    originalLine: 4,
    resolved: false,
    resolvedBy: null,
    outdated: false,
    can: all,
    comments: [
      {
        id: "PRRC_cache1",
        author: sam,
        body: "**major:** This cache never evicts. A busy shop keeps every receipt in memory until the process restarts.",
        createdAt: "2026-10-20T09:00:00Z",
        originalCommit: headSha,
      },
      {
        id: "PRRC_cache2",
        author: dana,
        body: "Entries expire after an hour, but you're right that they stay in the `Map`. I'll cap it.",
        createdAt: "2026-10-20T10:30:00Z",
        originalCommit: headSha,
      },
    ],
  },
  {
    id: "PRRT_ttl",
    path: "src/services/receipts.ts",
    side: "new",
    line: 3,
    startLine: null,
    originalLine: 3,
    resolved: false,
    resolvedBy: null,
    outdated: false,
    can: all,
    comments: [
      {
        id: "PRRC_ttl1",
        author: sam,
        body: "**minor:** Easier to read with a separator.\n\n```suggestion\nconst RECEIPT_TTL_MS = 60 * 60 * 1_000;\n```",
        createdAt: "2026-10-20T09:05:00Z",
        originalCommit: headSha,
      },
    ],
  },
  {
    id: "PRRT_charset",
    path: "src/routes/orders.ts",
    side: "new",
    line: 39,
    startLine: null,
    originalLine: 39,
    resolved: false,
    resolvedBy: null,
    outdated: false,
    can: all,
    comments: [
      {
        id: "PRRC_charset1",
        author: sam,
        body: 'Say the charset, or some clients guess Latin-1:\n\n```suggestion\n  res.type("text/plain; charset=utf-8").send(renderReceipt(order));\n```',
        createdAt: "2026-10-20T09:10:00Z",
        originalCommit: headSha,
      },
    ],
  },
  {
    id: "PRRT_rate",
    path: "config/app.yaml",
    side: "new",
    line: 13,
    startLine: null,
    originalLine: 13,
    resolved: true,
    resolvedBy: dana,
    outdated: false,
    can: all,
    comments: [
      {
        id: "PRRC_rate1",
        author: sam,
        body: "Why ten times the rate limit?",
        createdAt: "2026-10-20T09:15:00Z",
        originalCommit: headSha,
      },
      {
        id: "PRRC_rate2",
        author: dana,
        body: "Receipts are fetched in bursts after checkout. Load-tested at 600.",
        createdAt: "2026-10-20T11:00:00Z",
        originalCommit: headSha,
      },
    ],
  },
  {
    id: "PRRT_outdated",
    path: "src/services/receipts.ts",
    side: "new",
    line: null,
    startLine: null,
    originalLine: 12,
    resolved: false,
    resolvedBy: null,
    outdated: true,
    can: all,
    comments: [
      {
        id: "PRRC_outdated1",
        author: sam,
        body: "Return early here instead of nesting.",
        createdAt: "2026-10-19T15:00:00Z",
        originalCommit: "13fa1b41650d3dc4e2fd7f7d928af0a02fdd25cf",
      },
    ],
  },
  {
    id: "PRRT_unshown",
    path: "src/routes/orders.ts",
    side: "new",
    line: 12,
    startLine: 11,
    originalLine: 12,
    resolved: false,
    resolvedBy: null,
    outdated: false,
    can: all,
    comments: [
      {
        id: "PRRC_unshown1",
        author: sam,
        body: "Not this PR's change, but `listOrders` should page too.",
        createdAt: "2026-10-20T09:20:00Z",
        originalCommit: headSha,
      },
    ],
  },
];

export const smallFeatureThreadList: ThreadList = { threads: smallFeatureThreads };
