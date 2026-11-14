import { useState } from "react";
import { type FileChange, HunkId, parseUnifiedDiff } from "../../../src/domain/diff/index.ts";
import {
  type ModelOptions,
  type Point,
  PointId,
  type ReviewThread,
} from "../../../src/domain/review/index.ts";
import type { ClaudeRun } from "../pages/review/ClaudeElement.tsx";
import { lockedReason, type ModelChoice } from "../pages/review/model-choice.ts";
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

export const ADDED_FILE = one(`diff --git a/src/http/backoff.ts b/src/http/backoff.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/http/backoff.ts
@@ -0,0 +1,3 @@
+export const backoff = (attempt: number): number =>
+  Math.min(1000 * 2 ** attempt, 8000);
+
`);

export const DELETED_FILE = one(`diff --git a/src/http/legacy-retry.ts b/src/http/legacy-retry.ts
deleted file mode 100644
index 4444444..0000000
--- a/src/http/legacy-retry.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const retry = <T>(run: () => Promise<T>): Promise<T> =>
-  run().catch(() => run());
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
  {
    path: "src/http/retry.ts",
    status: "modified",
    additions: 4,
    deletions: 2,
    points: { finding: 1, decision: 2 },
  },
  { path: "src/http/client.ts", status: "modified", additions: 12, deletions: 3 },
  {
    path: "src/auth/session.ts",
    status: "modified",
    additions: 8,
    deletions: 8,
    points: { risk: 1 },
  },
  { path: "src/util/sleep.ts", status: "renamed", additions: 0, deletions: 0 },
  { path: "src/http/legacy-retry.ts", status: "deleted", additions: 0, deletions: 41 },
  { path: "src/http/retry.test.ts", status: "added", additions: 56, deletions: 0 },
  { path: "package.json", status: "modified", additions: 1, deletions: 1 },
  { path: "docs/flow.png", status: "modified", additions: 0, deletions: 0 },
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
        body: "Five attempts at `1, 2, 4, 8 s` is 15 s before failing.\n\nCheckout times out at 10 s:\n\n```ts\nconst CHECKOUT_TIMEOUT_MS = 10_000;\n```",
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
        body: "Does this need to be exported?",
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
        body: "AbortError isn't a network error; don't retry it.",
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
        body: "`attempts` reads as how many have run, not how many may.",
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

/** The hunk the points below rest on: the retry file's first. */
const HUNK_ID = RETRY_FILE.hunks[0]?.id ?? HunkId.parse("h_0123456789abcdef");

/** One of Claude's points of each kind, on the retry file's first hunk. */
export const POINTS: readonly Point[] = [
  {
    id: PointId.parse("f1"),
    kind: "finding",
    title: "Sleeps after the last attempt too",
    explanation:
      "After the fifth failure `retry` waits 16 s before it throws, so a caller learns of the failure 16 s late.",
    path: "src/http/retry.ts",
    lines: { hunkId: HUNK_ID, side: "new", startLine: 22, line: 23 },
    hunkIds: [HUNK_ID],
    severity: "major",
    suggestion: ["      if (attempt + 1 < attempts) await sleep(1000 * 2 ** attempt);"],
    mismatch: null,
  },
  {
    id: PointId.parse("r:h_0123456789abcdef"),
    kind: "risk",
    title: "Raises the default attempts from 3 to 5 for every caller.",
    explanation: "",
    path: "src/http/retry.ts",
    lines: { hunkId: HUNK_ID, side: "new", startLine: 14, line: 14 },
    hunkIds: [HUNK_ID],
    severity: null,
    suggestion: null,
    mismatch: null,
  },
  {
    id: PointId.parse("d1"),
    kind: "decision",
    title: "Why back off exponentially",
    explanation:
      "A flaky link gets more time to recover with each attempt, as the comment above the delay says.",
    path: "src/http/retry.ts",
    lines: { hunkId: HUNK_ID, side: "new", startLine: 22, line: 22 },
    hunkIds: [HUNK_ID],
    severity: null,
    suggestion: null,
    mismatch: null,
  },
];

/** As much of an analysis as Claude's element reads: how far its run got, and how it ended. */
export const DESIGN_RUN: ClaudeRun = {
  modelOption: null,
  status: "complete",
  stages: {
    collect: "done",
    prep: "done",
    intent: "skipped",
    findings: "skipped",
    risk: "skipped",
    decisions: "skipped",
    tour: "skipped",
  },
  modelError: null,
};

/** The reviewer's choice among `status`'s options, kept while the demo is on the page. */
export const useDemoChoice = (status: ModelOptions): ModelChoice => {
  const [chosenId, setChosenId] = useState(status.defaultId);
  return {
    options: status.options,
    chosen: status.options.find((option) => option.id === chosenId) ?? null,
    locked: lockedReason(status.options),
    choose: setChosenId,
  };
};
