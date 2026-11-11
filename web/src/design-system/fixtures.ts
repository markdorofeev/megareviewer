import { type FileChange, parseUnifiedDiff } from "../../../src/domain/diff/index.ts";
import type { ReviewThread } from "../../../src/domain/review/index.ts";
import type { FileEntry, PendingComment, PrSummary } from "../review/index.ts";

// Made-up data for the preview: an example repository, PR and people, none of them real.

const parse = (diff: string): readonly FileChange[] => {
  const parsed = parseUnifiedDiff(diff);
  if (!parsed.ok) throw new Error(`fixture diff: ${parsed.error.message}`);
  return parsed.value;
};

const one = (diff: string): FileChange => {
  const [file] = parse(diff);
  if (file === undefined) throw new Error("fixture diff: no file");
  return file;
};

/** A hunk's header and lines, its counts taken from the lines so they can't disagree. */
const hunk = (oldStart: number, newStart: number, heading: string, lines: readonly string[]) => {
  const old = lines.filter((line) => !line.startsWith("+")).length;
  const added = lines.filter((line) => !line.startsWith("-")).length;
  return [`@@ -${oldStart},${old} +${newStart},${added} @@${heading}`, ...lines];
};

const fileDiff = (path: string, hunks: readonly (readonly string[])[]): string =>
  [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    ...hunks.flat(),
    "",
  ].join("\n");

/** One changed line, for a draft on it. */
export const NETWORK_ERROR_FILE = one(
  fileDiff("src/http/network-error.ts", [
    hunk(8, 8, " export function isNetworkError(error: unknown): boolean {", [
      "-  return false;",
      '+  return error instanceof Error && NETWORK_CODES.has(Reflect.get(error, "code"));',
    ]),
  ]),
);

export const RETRY_FILE = one(
  fileDiff("src/http/retry.ts", [
    hunk(12, 12, ' import { sleep } from "./sleep";', [
      " ",
      " /** Retries a request that failed on the network. */",
      "-export async function retry<T>(run: () => Promise<T>, attempts = 3): Promise<T> {",
      "+export async function retry<T>(run: () => Promise<T>, attempts = 5): Promise<T> {",
      "   let lastError: unknown;",
      "   for (let attempt = 0; attempt < attempts; attempt++) {",
      "     try {",
      "       return await run();",
      "     } catch (error) {",
      "       lastError = error;",
      "-      await sleep(1000);",
      "+      // Back off: 1 s, 2 s, 4 s, ... so a flaky link gets time to recover.",
      "+      const delay = 1000 * 2 ** attempt;",
      "+      await sleep(delay);",
      "     }",
      "   }",
      "   throw lastError;",
    ]),
    hunk(40, 43, " export function isNetworkError(error: unknown): boolean {", [
      "   if (!(error instanceof Error)) return false;",
      '-  if (error.name === "AbortError") return true;',
      '   return error.message.includes("ECONNRESET") || error.message.includes("ETIMEDOUT");',
      " }",
      " ",
      " export const DEFAULT_TIMEOUT_MS = 60_000;",
    ]),
  ]),
);

export const RENAMED_FILE = one(`diff --git a/src/http/sleep.ts b/src/util/sleep.ts
similarity index 100%
rename from src/http/sleep.ts
rename to src/util/sleep.ts
`);

export const BINARY_FILE = one(`diff --git a/docs/flow.png b/docs/flow.png
index 1111111..2222222 100644
Binary files a/docs/flow.png and b/docs/flow.png differ
`);

/** A generated file of `lines` added lines, to show virtualization and the deferred state. */
export const generatedFile = (lines: number): FileChange =>
  one(
    fileDiff("src/generated/routes.ts", [
      hunk(
        1,
        1,
        "",
        Array.from({ length: lines }, (_, index) =>
          index % 4 === 0
            ? [
                `-export const route${index} = "/api/v1/items/${index}";`,
                `+export const route${index} = "/api/v2/items/${index}";`,
              ]
            : [` export const route${index} = "/api/v1/items/${index}"; // unchanged`],
        ).flat(),
      ),
    ]),
  );

export const PULL_REQUEST: PrSummary = {
  number: 128,
  url: "https://example.com/example/shop/pull/128",
  title: "Back off between retries of network failures",
  authorName: "Sam Example",
  sourceBranch: "retry-backoff",
  targetBranch: "main",
};

export const TREE_FILES: readonly FileEntry[] = [
  { path: "src/http/retry.ts", status: "modified", additions: 4, deletions: 2, contract: 0 },
  { path: "src/http/client.ts", status: "modified", additions: 12, deletions: 3, contract: 1 },
  { path: "src/auth/session.ts", status: "modified", additions: 8, deletions: 8, contract: 2 },
  { path: "src/util/sleep.ts", status: "renamed", additions: 0, deletions: 0, contract: 0 },
  { path: "src/http/legacy-retry.ts", status: "deleted", additions: 0, deletions: 41, contract: 0 },
  { path: "src/http/retry.test.ts", status: "added", additions: 56, deletions: 0, contract: 0 },
  { path: "package.json", status: "modified", additions: 1, deletions: 1, contract: 1 },
  { path: "docs/flow.png", status: "modified", additions: 0, deletions: 0, contract: 0 },
];

export const PENDING_COMMENTS: readonly PendingComment[] = [
  {
    id: "c1",
    path: "src/http/retry.ts",
    line: 16,
    excerpt: "Five attempts at 1, 2, 4, 8 s is 15 s before failing. Is that too long for checkout?",
  },
  {
    id: "c2",
    path: "src/http/retry.ts",
    line: 45,
    excerpt: "Why stop treating AbortError as a network error?",
  },
];

const sam = { id: "sam-example", name: "Sam Example" };
const dana = { id: "dana-kim", name: "Dana Kim" };
const thread = (fields: Partial<ReviewThread>): ReviewThread => ({
  id: "PRRT_demo",
  path: "src/http/retry.ts",
  side: "new",
  line: 16,
  startLine: null,
  originalLine: 16,
  resolved: false,
  resolvedBy: null,
  outdated: false,
  can: { reply: true, resolve: true },
  comments: [],
  ...fields,
});

/** One thread in each state the review page shows. */
export const THREADS = {
  open: thread({
    comments: [
      {
        id: "c_open1",
        author: sam,
        body: "**major:** Five attempts at `1, 2, 4, 8 s` is 15 s before failing.\n\nCheckout times out at 10 s:\n\n```ts\nconst CHECKOUT_TIMEOUT_MS = 10_000;\n```",
        createdAt: "2026-10-21T09:40:00Z",
        originalCommit: null,
      },
      {
        id: "c_open2",
        author: dana,
        body: "Good catch. I'll cap the total at 8 s.",
        createdAt: "2026-10-21T09:52:00Z",
        originalCommit: null,
      },
    ],
  }),
  resolved: thread({
    resolved: true,
    resolvedBy: dana,
    comments: [
      {
        id: "c_resolved1",
        author: sam,
        body: "**minor:** Does this need to be exported?",
        createdAt: "2026-10-20T15:00:00Z",
        originalCommit: null,
      },
    ],
  }),
  outdated: thread({
    outdated: true,
    line: null,
    originalLine: 12,
    comments: [
      {
        id: "c_outdated1",
        author: sam,
        body: "**blocking:** AbortError isn't a network error; don't retry it.",
        createdAt: "2026-10-19T11:00:00Z",
        originalCommit: null,
      },
    ],
  }),
  grouped: thread({
    comments: [
      {
        id: "c_grouped1",
        author: sam,
        body: "**minor:** `attempts` reads as how many have run, not how many may.",
        createdAt: "2026-10-21T07:10:00Z",
        originalCommit: null,
      },
      {
        id: "c_grouped2",
        author: sam,
        body: "`maxAttempts` would say it.",
        createdAt: "2026-10-21T07:12:00Z",
        originalCommit: null,
      },
      {
        id: "c_grouped3",
        author: dana,
        body: "Renamed it.",
        createdAt: "2026-10-21T09:58:00Z",
        originalCommit: null,
      },
    ],
  }),
  suggestion: thread({
    comments: [
      {
        id: "c_suggestion1",
        author: sam,
        body: "Name what it counts:\n\n```suggestion\nconst MAX_ATTEMPTS = 3;\n```",
        createdAt: "2026-10-21T08:00:00Z",
        originalCommit: null,
      },
    ],
  }),
} as const satisfies Record<string, ReviewThread>;
