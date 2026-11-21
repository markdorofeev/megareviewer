import { useState } from "react";
import { type FileChange, HunkId, parseUnifiedDiff } from "../../../src/domain/diff/index.ts";
import {
  type ModelOptions,
  type Point,
  PointId,
  type ReviewThread,
} from "../../../src/domain/review/index.ts";
import { scopeOptions } from "../pages/preferences/rule.tsx";
import type { ClaudeRun } from "../pages/review/ClaudeElement.tsx";
import { lockedReason, type ModelChoice } from "../pages/review/model-choice.ts";
import type { PointActions } from "../pages/review/PointCard.tsx";
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

/**
 * A Spring service in modern Java, in three hunks: one at the top of the file, one that starts in
 * the class body and one inside a method, since the grammar reads each from where it starts.
 */
export const JAVA_FILE = one(
  fileDiff("src/main/java/works/weave/socks/orders/service/OrderService.java", [
    hunk(1, 1, "", [
      " package works.weave.socks.orders.service;",
      " ",
      " import static java.util.stream.Collectors.toList;",
      " ",
      " import java.util.List;",
      " import java.util.Map;",
      "+import java.util.Optional;",
      " import org.springframework.web.bind.annotation.*;",
      " ",
      " /**",
      "  * Places orders and reports their totals.",
      "  *",
      "  * @param <T> the kind of item",
      "  */",
      " @RestController",
      '-@RequestMapping("/orders")',
      '+@RequestMapping(value = "/orders", produces = "application/json")',
      " public class OrderService<T extends Item & Comparable<? super T>> implements Service {",
      "-    private static final int MAX_ITEMS = 100;",
      "+    private static final int MAX_ITEMS = 1_000;",
      "+    private static final long TIMEOUT_MS = 30_000L;",
      "     private final OrderRepository repository;",
      "     private int count = 0x1F;",
    ]),
    hunk(27, 29, "  public OrderService(OrderRepository repository) {", [
      "     public record Line(String sku, int quantity, double price) {}",
      " ",
      "     enum Status { PENDING, SHIPPED, CANCELLED }",
      " ",
      "     interface Priced {",
      "         double price();",
      " ",
      "         default double total(int quantity) {",
      "             return price() * quantity;",
      "         }",
      "     }",
      " ",
      '     @GetMapping("/{id}")',
      '-    public Order find(@PathVariable("id") String id) {',
      "-        return repository.findOne(id);",
      '+    public Optional<Order> find(@PathVariable("id") String id) throws NotFoundException {',
      "+        // Look the order up, then fall back to the archive.",
      "+        var order = repository.findById(id);",
      "+        if (order instanceof PersistentOrder persistent && persistent.isActive()) {",
      "+            return Optional.of((Order) persistent);",
      "+        }",
      "+        return Optional.empty();",
      "     }",
      " ",
      "     public List<String> skus(List<? extends Line> lines) {",
      "         return lines.stream()",
      "                 .filter(line -> line.quantity() > 0)",
      "                 .map(Line::sku)",
      "                 .sorted(String::compareTo)",
      "                 .collect(toList());",
      "     }",
    ]),
    hunk(57, 64, "  public String label(Status status) {", [
      '             case PENDING -> "Waiting";',
      '             case SHIPPED -> "On its way";',
      '-            default -> "Unknown";',
      '+            default -> throw new IllegalStateException("Unknown: " + status);',
      "         };",
      "     }",
      " ",
      "     public String query() {",
      '-        String sql = "SELECT id, total FROM orders";',
      '+        String sql = """',
      "+                SELECT id, total",
      "+                FROM orders",
      '+                """;',
      '         return sql + " LIMIT " + MAX_ITEMS;',
      "     }",
      " ",
      "     public void save(Path path) throws IOException {",
      "         try (var writer = Files.newBufferedWriter(path)) {",
      "             writer.write(String.valueOf(count));",
      "         } catch (IOException e) {",
      "-            e.printStackTrace();",
      '+            log.error("Failed to save", e);',
      "+            throw e;",
      "         }",
      "     }",
      " ",
      "     public Order build(Customer customer) {",
      "         int[] counts = new int[MAX_ITEMS];",
      "         Map<String, List<Line>> bySku = new HashMap<>();",
      "         boolean empty = counts.length == 0 && bySku.isEmpty();",
      "         char separator = ',';",
      "         float ratio = 1.5f;",
      "-        return new Order(customer, List.of(), empty ? 0.0 : ratio * 2);",
      "+        return Order.builder()",
      "+                .customer(customer)",
      "+                .items(List.of())",
      "+                .total(empty ? 0.0 : ratio * 2)",
      "+                .build();",
      "     }",
      " }",
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

const SVM = "substratevm/src/";
const CORE = `${SVM}com.oracle.svm.core/src/com/oracle/svm/core/`;
const HOSTED = `${SVM}com.oracle.svm.hosted/src/com/oracle/svm/hosted/`;

type Change = readonly [
  name: string,
  additions: number,
  deletions?: number,
  findings?: number,
  threads?: number,
];

const java = (directory: string, status: FileEntry["status"], changes: readonly Change[]) =>
  changes.map(
    ([name, additions, deletions = 0, findings = 0, threads = 0]): FileEntry => ({
      path: `${directory}${name}.java`,
      status,
      additions,
      deletions,
      ...(findings > 0 ? { points: { finding: findings } } : {}),
      ...(threads > 0 ? { threads } : {}),
    }),
  );

/** GraalVM's PGO pull request as the file tree's design draws it: 46 files in Java modules. */
export const SUBSTRATEVM_FILES: readonly FileEntry[] = [
  ...java(`${CORE}pgo/`, "added", [
    ["BranchProfileRecorder", 300, 0, 0, 2],
    ["BranchProfileThreadLocal", 139],
    ["CallCountProfileKey", 73],
    ["CallCountProfileRecorder", 645, 0, 1],
    ["CallCountProfileSlot", 40],
    ["IprofWriter", 599],
    ["ProfileDumper", 168],
    ["ProfileFrame", 113],
    ["StackSampleRecorder", 397],
    ["SwitchProfileKey", 110],
    ["SwitchProfileRecorder", 103],
    ["TypeProfileKey", 93],
    ["TypeProfileRecorder", 749, 0, 0, 1],
  ]),
  {
    path: `${CORE}thread/RecurringCallbackSupport.java`,
    status: "modified",
    additions: 60,
    deletions: 3,
    points: { risk: 1 },
    threads: 1,
  },
  ...java(`${CORE}thread/`, "modified", [
    ["ThreadListener", 11],
    ["ThreadListenerSupport", 7],
    ["VMThreads", 9],
  ]),
  ...java(`${HOSTED}pgo/`, "added", [
    ["BranchProfileApplier", 188],
    ["CallCountProfileApplier", 231],
    ["InliningProfileProvider", 219],
    ["InstrumentBranchesPhase", 205],
    ["InstrumentCallCountsPhase", 198],
    ["IprofParser", 538, 0, 1, 1],
    ["PGOOptions", 88],
    ["ProfileDatabase", 276],
    ["ProfileDumpFeature", 76],
    ["ProfileInstrumentationPhase", 471],
    ["ProfileMerger", 183],
    ["StackSampleAggregator", 262],
    ["TypeProfileApplier", 309],
  ]),
  ...java(`${HOSTED}pgo/`, "modified", [["PGOFeature", 42, 6]]),
  {
    path: `${HOSTED}pgo/ProfileReader.java`,
    oldPath: `${HOSTED}pgo/ProfileFileReader.java`,
    status: "renamed",
    additions: 38,
    deletions: 12,
  },
  {
    path: `${HOSTED}pgo/LegacyProfileFormat.java`,
    status: "deleted",
    additions: 0,
    deletions: 184,
  },
  {
    path: `${HOSTED}pgo/resources/iprof-schema.json`,
    status: "added",
    additions: 57,
    deletions: 0,
  },
  ...java(`${HOSTED}code/`, "modified", [
    ["CEntryPointCallStubSupport", 4, 1],
    ["CompileQueue", 38, 12, 0, 3],
    ["DeoptimizationUtils", 12, 3],
    ["HostedRuntimeConfigurationBuilder", 9, 1],
    ["NativeImageCodeCache", 6],
    ["SharedRuntimeConfigurationBuilder", 5, 2],
    ["SubstrateCompilationDirectives", 27, 4],
    ["SubstrateGraphBuilderPhase", 14, 2],
  ]),
  {
    path: `${SVM}com.oracle.svm.hosted/src/META-INF/services/com.oracle.svm.core.feature.InternalFeature`,
    status: "modified",
    additions: 2,
    deletions: 0,
  },
  ...java(`${SVM}com.oracle.svm.test/src/com/oracle/svm/test/pgo/`, "added", [
    ["IprofWriterTest", 212],
  ]),
  {
    path: "substratevm/mx.substratevm/suite.py",
    status: "modified",
    additions: 24,
    deletions: 2,
    threads: 1,
  },
  {
    path: "docs/reference-manual/native-image/PGO-Instrumentation.md",
    status: "added",
    additions: 96,
    deletions: 0,
  },
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
  markdown: thread({
    comments: [
      {
        id: "c_markdown1",
        author: sam,
        body: [
          "### Retries",
          "",
          "This **retries a 4xx** too, which _never_ succeeds on a second try:  ",
          "a `400` stays a `400`. ~~Backoff~~ The cap is fine.",
          "",
          "> Retry only network errors and 5xx.",
          "",
          "1. Check `error.status` first",
          "2. Keep the cap at 8 s",
          "   - [x] total delay",
          "   - [ ] per attempt",
          "",
          "| Status | Retried |",
          "| :--- | :---: |",
          "| 503 | yes |",
          "| 404 | no |",
          "",
          "See [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110#name-status-codes).",
        ].join("\n"),
        createdAt: "2026-10-21T08:30:00Z",
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

export const DEMO_REPO = { host: "github", owner: "acme", repo: "scheduler" } as const;

/** What a point's card takes for guidance, where an example folds nothing and saves no rule. */
export const POINT_GUIDANCE: Pick<PointActions, "leftOut" | "onShow" | "ruleScopes" | "onRule"> = {
  leftOut: false,
  onShow: () => {},
  ruleScopes: scopeOptions([DEMO_REPO]).reverse(),
  onRule: async () => null,
};

/** As much of an analysis as Claude's element reads: how far its run got, and how it ended. */
export const DESIGN_RUN: ClaudeRun = {
  modelOption: null,
  usage: [],
  status: "complete",
  stages: {
    collect: "done",
    prep: "done",
    intent: "skipped",
    findings: "skipped",
    risk: "skipped",
    decisions: "skipped",
  },
  modelError: null,
};

/** The reviewer's choice among `status`'s options, kept while the demo is on the page. */
export const useDemoChoice = (status: ModelOptions): ModelChoice => {
  const [chosenId, setChosenId] = useState(status.defaultId);
  return {
    options: status.options,
    chosen: status.options.find((option) => option.id === chosenId) ?? null,
    defaultId: status.defaultId,
    locked: lockedReason(status.options),
    choose: setChosenId,
  };
};
