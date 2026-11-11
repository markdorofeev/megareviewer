import { type FileChange, parseUnifiedDiff } from "../../../src/domain/diff/index.ts";
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
