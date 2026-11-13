// biome-ignore-all lint/suspicious/noTemplateCurlyInString: these strings are diff lines of TypeScript.
import type { AnalysisView } from "../../../contracts/index.ts";
import {
  type CallGraphHint,
  type FileChange,
  findFormattingProofs,
  findMechanicalProofs,
  type HunkId,
  type HunkPart,
  PartId,
  parseUnifiedDiff,
} from "../../../src/domain/diff/index.ts";
import {
  type Analysis,
  type AnalysisKey,
  analysisId,
  DecisionId,
  FindingId,
  MismatchId,
  type ModelUsage,
  type PullRequest,
  type RiskAssessment,
  type Ticket,
  TourStepId,
} from "../../../src/domain/review/index.ts";
import { callSitesOf } from "./call-sites.ts";

// One complete analysis of a realistic PR: an endpoint that leaks other users' receipts, a retry
// and a cache worth discussing, a new dependency, and one of each mechanical change. The diff is
// parsed and proved by the real domain code, so hunk IDs and proofs are what the server would
// produce. The hunk that adds the retry and the cache is split: the cache is read with the
// endpoint that calls it, the retry in a step of its own.

interface FileDiff {
  readonly header: readonly string[];
  readonly hunks: readonly {
    readonly oldStart: number;
    readonly newStart: number;
    readonly heading?: string;
    readonly lines: readonly string[];
  }[];
}

const count = (lines: readonly string[], prefixes: string): number =>
  lines.filter((line) => prefixes.includes(line.charAt(0))).length;

const unifiedDiff = (files: readonly FileDiff[]): string =>
  files
    .flatMap((file) => [
      ...file.header,
      ...file.hunks.flatMap(({ oldStart, newStart, heading, lines }) => [
        `@@ -${oldStart},${count(lines, " -")} +${newStart},${count(lines, " +")} @@${heading === undefined ? "" : ` ${heading}`}`,
        ...lines,
      ]),
    ])
    .map((line) => `${line}\n`)
    .join("");

const modified = (path: string, index: string): readonly string[] => [
  `diff --git a/${path} b/${path}`,
  `index ${index} 100644`,
  `--- a/${path}`,
  `+++ b/${path}`,
];

const DIFF = unifiedDiff([
  {
    header: modified("package.json", "3b18e51..9c2f0a4"),
    hunks: [
      {
        oldStart: 11,
        newStart: 11,
        lines: [
          '   "private": true,',
          '   "dependencies": {',
          '+    "dayjs": "1.11.13",',
          '     "express": "5.1.0",',
          '     "pg": "8.16.3",',
          '     "zod": "4.1.12"',
          "   },",
          '   "devDependencies": {',
        ],
      },
    ],
  },
  {
    header: modified("pnpm-lock.yaml", "5d41402..e1f9a3c"),
    hunks: [
      {
        oldStart: 8,
        newStart: 8,
        heading: "importers:",
        lines: [
          "   .:",
          "     dependencies:",
          "+      dayjs:",
          "+        specifier: 1.11.13",
          "+        version: 1.11.13",
          "       express:",
          "         specifier: 5.1.0",
          "         version: 5.1.0",
        ],
      },
      {
        oldStart: 312,
        newStart: 315,
        heading: "packages:",
        lines: [
          "     resolution: {integrity: sha512-9Fcl1K7bLy3yR0Vy1ydKMzh0eI1Gc+4l5EvQ5a2JpQ4Q==}",
          "     engines: {node: '>= 0.8'}",
          " ",
          "+  dayjs@1.11.13:",
          "+    resolution: {integrity: sha512-oaMBel6gjolK862uaPQOVTA7q3TZhuSvuMQAAglQDOWYO9A91IrAOUJEyKVlqJlHE0vq5p5UXxzdPfMH/x6xNg==}",
          "+",
          "   debug@4.4.1:",
          "     resolution: {integrity: sha512-KcKCqiftBJcZr++7ykoDIEwSa3XWowTfNPo92BYxjXiyYEVrUQh2aLyhxBCwww+heortUFxEJYcRzosstTEBYQ==}",
          "     engines: {node: '>=6.0'}",
        ],
      },
    ],
  },
  {
    header: [
      "diff --git a/src/config/defaults.ts b/src/config/defaults.ts",
      "index 8e1d2b7..c4a9f03 100644",
      "--- a/src/config/defaults.ts",
      "+++ b/src/config/defaults.ts",
    ],
    hunks: [
      {
        oldStart: 1,
        newStart: 1,
        lines: [
          '-export const DEFAULTS = { port: 8080, taxServiceUrl: "http://tax.internal", timeoutMs: 5000 };',
          "+export const DEFAULTS = {",
          "+  port: 8080,",
          '+  taxServiceUrl: "http://tax.internal",',
          "+  timeoutMs: 5000",
          "+};",
          " ",
          "-export const LIMITS = { maxItemsPerOrder: 100, maxOpenOrders: 20 };",
          "+export const LIMITS = {",
          "+  maxItemsPerOrder: 100,",
          "+  maxOpenOrders: 20",
          "+};",
        ],
      },
    ],
  },
  {
    header: [
      "diff --git a/src/lib/money.ts b/src/lib/money.ts",
      "new file mode 100644",
      "index 0000000..4f2a1c9",
      "--- /dev/null",
      "+++ b/src/lib/money.ts",
    ],
    hunks: [
      {
        oldStart: 0,
        newStart: 1,
        lines: [
          "+export const formatMoney = (cents: number, currency: string): string => {",
          "+  const amount = (cents / 100).toFixed(2);",
          '+  return currency === "USD" ? `$${amount}` : `${amount} ${currency}`;',
          "+};",
        ],
      },
    ],
  },
  {
    header: modified("src/routes/orders.ts", "a41c0e2..7bd93f5"),
    hunks: [
      {
        oldStart: 1,
        newStart: 1,
        lines: [
          ' import { Router } from "express";',
          ' import { requireUser } from "../auth.ts";',
          '-import { findOrder, listOrders, type Order } from "../services/orders.ts";',
          '+import { formatMoney } from "../lib/money.ts";',
          '+import { findOrder, findOrderById, listOrders, type Order } from "../services/orders.ts";',
          '+import { cachedReceipt } from "../services/receipts.ts";',
          " ",
          " export const ordersRouter = Router();",
          " ",
        ],
      },
      {
        oldStart: 8,
        newStart: 10,
        heading: 'ordersRouter.get("/orders", requireUser, async (req, res) => {',
        lines: [
          "   const orders = await listOrders(req.user.id);",
          "   res.json(orders.map(toResponse));",
          " });",
          "+",
          '+ordersRouter.get("/orders/:id/receipt", requireUser, async (req, res) => {',
          "+  const order = await findOrderById(req.params.id);",
          "+  if (!order) {",
          '+    res.status(404).json({ error: "not found" });',
          "+    return;",
          "+  }",
          '+  res.type("text/plain").send(await cachedReceipt(order));',
          "+});",
          " ",
          ' ordersRouter.get("/orders/:id", requireUser, async (req, res) => {',
          "   const order = await findOrder(req.user.id, req.params.id);",
        ],
      },
      {
        oldStart: 18,
        newStart: 29,
        heading: 'ordersRouter.get("/orders/:id", requireUser, async (req, res) => {',
        lines: [
          "   res.json(toResponse(order));",
          " });",
          " ",
          "-export const formatMoney = (cents: number, currency: string): string => {",
          "-  const amount = (cents / 100).toFixed(2);",
          '-  return currency === "USD" ? `$${amount}` : `${amount} ${currency}`;',
          "-};",
          "-",
          " const toResponse = (order: Order) => ({",
          "   id: order.id,",
          "   status: order.status,",
        ],
      },
    ],
  },
  {
    header: modified("src/services/receipts.ts", "d0e77a1..f3b2c68"),
    hunks: [
      {
        oldStart: 1,
        newStart: 1,
        lines: [
          '+import dayjs from "dayjs";',
          '+import { formatMoney } from "../lib/money.ts";',
          ' import type { Order } from "./orders.ts";',
          ' import { fetchTaxLines, type TaxLine } from "./tax.ts";',
          " ",
          "-const formatDate = (date: Date): string => date.toISOString().slice(0, 10);",
          '+const formatDate = (date: Date): string => dayjs(date).format("D MMMM YYYY");',
          " ",
          " const MAX_ITEM_NAME = 40;",
          " ",
          ' const itemLine = (item: Order["items"][number]): string => {',
          "   const name = item.name.slice(0, MAX_ITEM_NAME).padEnd(MAX_ITEM_NAME);",
          "-  return `${item.quantity} × ${name} ${item.priceCents}`;",
          "+  return `${item.quantity} × ${name} ${formatMoney(item.priceCents, item.currency)}`;",
          " };",
          " ",
          " /** Plain-text receipt for one order. */",
        ],
      },
      {
        oldStart: 24,
        newStart: 26,
        heading: "export const renderReceipt = async (order: Order): Promise<string> => {",
        lines: [
          '   return lines.join("\\n");',
          " };",
          " ",
          "-const loadTaxLines = async (order: Order): Promise<TaxLine[]> => {",
          "-  return fetchTaxLines(order);",
          "-};",
          "+const TAX_ATTEMPTS = 3;",
          "+",
          "+const loadTaxLines = async (order: Order): Promise<TaxLine[]> => {",
          "+  for (let attempt = 1; ; attempt++) {",
          "+    try {",
          "+      return await fetchTaxLines(order);",
          "+    } catch (error) {",
          "+      if (attempt === TAX_ATTEMPTS) throw error;",
          "+    }",
          "+  }",
          "+};",
          "+",
          "+const receiptCache = new Map<string, string>();",
          "+",
          "+/** Receipts don't change once an order is placed, so each is rendered once. */",
          "+export const cachedReceipt = async (order: Order): Promise<string> => {",
          "+  const cached = receiptCache.get(order.id);",
          "+  if (cached !== undefined) return cached;",
          "+  const receipt = await renderReceipt(order);",
          "+  receiptCache.set(order.id, receipt);",
          "+  return receipt;",
          "+};",
        ],
      },
    ],
  },
  {
    header: [
      "diff --git a/src/utils/dates.ts b/src/lib/dates.ts",
      "similarity index 100%",
      "rename from src/utils/dates.ts",
      "rename to src/lib/dates.ts",
    ],
    hunks: [],
  },
]);

const LANGUAGES: Readonly<Record<string, string>> = { ts: "typescript", json: "json" };

const parsed = parseUnifiedDiff(DIFF);
if (!parsed.ok) throw new Error(`fixture diff: line ${parsed.error.line}: ${parsed.error.message}`);
const files: readonly FileChange[] = parsed.value.map((file) => ({
  ...file,
  language: LANGUAGES[file.path.split(".").at(-1) ?? ""] ?? null,
}));

const hunkIn = (path: string, index: number): HunkId => {
  const id = files.find((file) => file.path === path)?.hunks[index]?.id;
  if (id === undefined) throw new Error(`fixture: no hunk ${index} in ${path}`);
  return id;
};

/** Every file's whole text is in its one hunk, so each side is the hunk's lines for that side. */
const sideOf = (file: FileChange, kinds: readonly string[]): string =>
  file.hunks
    .flatMap((hunk) => hunk.lines.filter((line) => kinds.includes(line.kind)))
    .map((line) => line.text)
    .join("\n");

// The fake code parser's syntax nodes: the source's tokens.
const tokens = (source: string) =>
  (source.match(/\w+|[^\s\w]/g) ?? []).map((text) => ({ type: "token", text }));

const defaults = files.find((file) => file.path === "src/config/defaults.ts");
const proofs = [
  ...findMechanicalProofs(files, {
    gitattributes: null,
    baseContents: new Map(),
    headContents: new Map(),
  }),
  ...findFormattingProofs(
    files,
    new Map(
      defaults === undefined
        ? []
        : [
            [
              defaults.path,
              {
                base: tokens(sideOf(defaults, ["context", "del"])),
                head: tokens(sideOf(defaults, ["context", "add"])),
              },
            ],
          ],
    ),
  ),
];

export const fixtureHunks = {
  dependency: hunkIn("package.json", 0),
  routeImports: hunkIn("src/routes/orders.ts", 0),
  receiptRoute: hunkIn("src/routes/orders.ts", 1),
  formatMoneyRemoved: hunkIn("src/routes/orders.ts", 2),
  formatMoneyAdded: hunkIn("src/lib/money.ts", 0),
  receiptFormatting: hunkIn("src/services/receipts.ts", 0),
  retryAndCache: hunkIn("src/services/receipts.ts", 1),
} as const;

const h = fixtureHunks;

/** The retry and cache hunk's two parts: its first 17 lines retry, the rest cache. */
const parts: readonly HunkPart[] = [
  {
    id: PartId.parse(`${h.retryAndCache}.1`),
    hunkId: h.retryAndCache,
    start: 0,
    end: 17,
    definitions: ["loadTaxLines", "TAX_ATTEMPTS"],
  },
  {
    id: PartId.parse(`${h.retryAndCache}.2`),
    hunkId: h.retryAndCache,
    start: 17,
    end: 28,
    definitions: ["receiptCache", "cachedReceipt"],
  },
];

export const fixtureParts = {
  retry: PartId.parse(`${h.retryAndCache}.1`),
  cache: PartId.parse(`${h.retryAndCache}.2`),
} as const;

const ticket: Ticket = {
  key: "SHOP-142",
  url: "https://acme.atlassian.net/browse/SHOP-142",
  summary: "Customers can download a receipt for their order",
  description:
    "As a customer, I want to download a receipt for a completed order from the order page.\n\nOnly the customer who placed the order may download its receipt.",
  type: "Story",
  status: "In Review",
};

const pullRequest: PullRequest = {
  ref: { repo: { host: "github", owner: "acme", repo: "shop" }, number: 128 },
  url: "https://github.com/acme/shop/pull/128",
  title: "Add order receipts endpoint",
  description:
    "Adds `GET /orders/:id/receipt` so customers can download a plain-text receipt (SHOP-142).\n\nMoves `formatMoney` into `src/lib/money.ts` so the receipt renderer can share it, and moves `utils/dates.ts` next to it.",
  author: { id: "sam-rivera", name: "Sam Rivera" },
  sourceBranch: "shop-142-order-receipts",
  targetBranch: "main",
  baseSha: "4c1f0e9a7b2d3c5e6f8091a2b3c4d5e6f7a8b9c0",
  headSha: "9e8d7c6b5a49382716051f2e3d4c5b6a79881726",
  commits: [
    {
      sha: "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
      message: "Move formatMoney into lib/money",
      author: "Sam Rivera",
    },
    {
      sha: "2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e",
      message: "Add the receipt endpoint (SHOP-142, SHOP-139)",
      author: "Sam Rivera",
    },
    {
      sha: "9e8d7c6b5a49382716051f2e3d4c5b6a79881726",
      message: "Retry the tax service and cache receipts",
      author: "Sam Rivera",
    },
  ],
  diff: DIFF,
  createdAt: "2026-10-19T14:02:00Z",
  updatedAt: "2026-10-21T09:41:00Z",
};

const key: AnalysisKey = {
  ref: pullRequest.ref,
  headSha: pullRequest.headSha,
  pipelineVersion: "1+claude-opus-5-5/p3",
};

const provedHunks = new Set(
  proofs.flatMap((proof) => (proof.hunkId === null ? [] : [proof.hunkId])),
);

const modelRisk: readonly RiskAssessment[] = [
  {
    hunkId: h.dependency,
    riskClass: "contract",
    reason: "Adds a runtime dependency.",
    source: "model",
  },
  {
    hunkId: h.routeImports,
    riskClass: "logic",
    reason: "Imports for the new route.",
    source: "model",
  },
  {
    hunkId: h.receiptRoute,
    riskClass: "contract",
    reason: "Adds a public endpoint, GET /orders/:id/receipt, that clients will build on.",
    source: "model",
  },
  {
    hunkId: h.receiptFormatting,
    riskClass: "logic",
    reason: "Changes how dates and prices appear on receipts.",
    source: "model",
  },
  {
    hunkId: h.retryAndCache,
    riskClass: "logic",
    reason: "Retries tax service calls and caches rendered receipts in memory.",
    source: "model",
  },
];

const usage: readonly ModelUsage[] = [
  {
    pass: "intent",
    inputTokens: 41_820,
    cacheReadTokens: 0,
    cacheWriteTokens: 38_400,
    outputTokens: 1_240,
    costUsd: 0.36,
    billing: "api",
  },
  {
    pass: "risk",
    inputTokens: 3_160,
    cacheReadTokens: 38_400,
    cacheWriteTokens: 0,
    outputTokens: 610,
    costUsd: 0.08,
    billing: "api",
  },
  {
    pass: "decisions",
    inputTokens: 3_420,
    cacheReadTokens: 38_400,
    cacheWriteTokens: 0,
    outputTokens: 4_980,
    costUsd: 0.21,
    billing: "api",
  },
  {
    pass: "tour",
    inputTokens: 5_870,
    cacheReadTokens: 38_400,
    cacheWriteTokens: 0,
    outputTokens: 1_530,
    costUsd: 0.12,
    billing: "api",
  },
];

const callGraph: CallGraphHint[] = [
  {
    fromPartId: h.receiptRoute,
    toPartId: fixtureParts.cache,
    symbol: "cachedReceipt",
    line: 20,
    use: "call",
  },
  {
    fromPartId: h.receiptFormatting,
    toPartId: h.formatMoneyAdded,
    symbol: "formatMoney",
    line: 12,
    use: "call",
  },
];

const analysis: Analysis = {
  id: analysisId(key),
  key,
  status: "complete",
  stages: {
    collect: "done",
    prep: "done",
    intent: "done",
    findings: "done",
    risk: "done",
    decisions: "done",
    tour: "done",
  },
  filesFetched: null,
  pullRequest,
  files,
  tickets: [ticket],
  missingTicketKeys: ["SHOP-139"],
  proofs,
  parts,
  callGraph,
  callSites: callSitesOf(files, callGraph),

  fileLinks: [
    { from: "src/routes/orders.ts", to: "src/lib/money.ts" },
    { from: "src/routes/orders.ts", to: "src/services/receipts.ts" },
    { from: "src/services/receipts.ts", to: "src/lib/money.ts" },
  ],
  generated: [],
  checkout: "read",
  unchangedCallers: [
    {
      partId: h.receiptFormatting,
      symbol: "renderReceipt",
      uses: [
        {
          path: "src/jobs/email-receipts.ts",
          line: 14,
          use: "call",
          excerpt: {
            start: 12,
            lines: [
              "  for (const order of await completedSince(lastRun)) {",
              "    const customer = await findCustomer(order.customerId);",
              "    const text = await renderReceipt(order);",
              '    await sendMail(customer.email, "Your receipt", text);',
              "  }",
            ],
          },
        },
        {
          path: "test/jobs/email-receipts.test.ts",
          line: 31,
          use: "call",
          excerpt: {
            start: 29,
            lines: [
              '  it("mails one receipt per completed order", async () => {',
              "    const orders = [completedOrder(), completedOrder()];",
              '    expect(await renderReceipt(orders[0])).toContain("Total");',
              "    await emailReceipts(orders);",
              "    expect(sent).toHaveLength(2);",
            ],
          },
        },
      ],
      more: 0,
    },
  ],
  intent: {
    stated: {
      summary:
        "Let customers download a plain-text receipt for a completed order. Only the customer who placed the order may download it.",
      sources: [
        { kind: "description", ref: null },
        { kind: "ticket", ref: "SHOP-142" },
      ],
    },
    inferred: {
      summary:
        "Adds a receipt download endpoint, retries the tax service, caches rendered receipts in memory and changes the date format on receipts.",
      behaviorChanges: [
        "GET /orders/:id/receipt returns a plain-text receipt for any order ID to any signed-in user.",
        "Tax lines are fetched up to 3 times, back to back, before the receipt fails.",
        "Each rendered receipt stays in memory for the life of the process.",
        'Receipts show dates as "21 October 2026" instead of "2026-10-21", and prices as money.',
      ],
    },
    mismatches: [
      {
        kind: "contradicts",
        description:
          "SHOP-142 says only the customer who placed the order may download its receipt, but the endpoint looks the order up by ID alone, so any signed-in user can read any receipt.",
        hunkIds: [h.receiptRoute],
      },
    ],
  },
  risk: [
    ...proofs.flatMap((proof): RiskAssessment[] =>
      proof.hunkId === null
        ? []
        : [
            {
              hunkId: proof.hunkId,
              riskClass: "mechanical",
              reason: proof.detail,
              source: "proof",
            },
          ],
    ),
    ...modelRisk.filter((assessment) => !provedHunks.has(assessment.hunkId)),
  ],
  findings: [
    {
      id: FindingId.parse("f1"),
      title: "Any signed-in user can read every customer's receipt",
      explanation:
        "`findOrderById` takes the ID alone, and order IDs are sequential. The route below it scopes the order by `req.user.id`; this one doesn't.",
      lines: { hunkId: h.receiptRoute, side: "new", startLine: 15, line: 15 },
      severity: "blocking",
      suggestion: ["  const order = await findOrder(req.user.id, req.params.id);"],
      mismatch: MismatchId.parse("m1"),
    },
    {
      id: FindingId.parse("f2"),
      title: "Keeps serving a receipt rendered before a refund",
      explanation:
        "`receiptCache` is keyed by order ID and never cleared, so after a refund or an edited item the old receipt is served until the process restarts.",
      lines: { hunkId: h.retryAndCache, side: "new", startLine: 45, line: 46 },
      severity: "major",
      suggestion: null,
      mismatch: null,
    },
    {
      id: FindingId.parse("f3"),
      title: "Retries the tax service back to back",
      explanation:
        "Three attempts with no delay triple the load on a tax service that's already failing.",
      lines: { hunkId: h.retryAndCache, side: "new", startLine: 32, line: 37 },
      severity: "minor",
      suggestion: null,
      mismatch: null,
    },
  ],
  decisions: [
    {
      id: DecisionId.parse("d1"),
      title: "Why plain text, not a PDF",
      category: "api",
      whyItMatters:
        "SHOP-142 asks for a receipt to download; plain text needs no renderer and no new dependency.",
      hunkIds: [h.receiptRoute],
      lines: { hunkId: h.receiptRoute, side: "new", startLine: 20, line: 20 },
    },
    {
      id: DecisionId.parse("d2"),
      title: "Why cache rendered receipts",
      category: "performance",
      whyItMatters:
        "Rendering calls the tax service; a cached receipt is sent again without calling it.",
      hunkIds: [h.retryAndCache],
      lines: { hunkId: h.retryAndCache, side: "new", startLine: 44, line: 44 },
    },
    {
      id: DecisionId.parse("d3"),
      title: "Why dayjs for one date format",
      category: "dependency",
      whyItMatters:
        'Receipts show dates as "21 October 2026"; dayjs writes that in one call, where toISOString gave only "2026-10-21".',
      hunkIds: [h.receiptFormatting, h.dependency],
      lines: { hunkId: h.receiptFormatting, side: "new", startLine: 6, line: 6 },
    },
    {
      id: DecisionId.parse("d4"),
      title: "Why move formatMoney into src/lib",
      category: "other",
      whyItMatters:
        "The receipt renderer now formats prices too, so the helper moved where both can import it.",
      hunkIds: [h.receiptFormatting],
      lines: { hunkId: h.receiptFormatting, side: "new", startLine: 2, line: 2 },
    },
  ],
  tour: {
    steps: [
      {
        id: TourStepId.parse("s1"),
        title: "The receipt endpoint",
        explanation:
          "Start at the new route: it looks up the order, gets its receipt from cachedReceipt, which renders each receipt once, and sends it as plain text.",
        partIds: [h.receiptRoute, h.routeImports, fixtureParts.cache],
        kind: "flow",
        via: [],
        entries: [h.receiptRoute],
        codeTitle: "GET /orders/:id/receipt",
        merged: [],
      },
      {
        id: TourStepId.parse("s2"),
        title: "Retrying the tax service",
        explanation: "Rendering a receipt now retries the tax service up to 3 times.",
        partIds: [fixtureParts.retry],
        kind: "flow",
        via: [],
        entries: [],
        codeTitle: "loadTaxLines",
        merged: [],
      },
      {
        id: TourStepId.parse("s3"),
        title: "Dates and prices on the receipt",
        explanation:
          "Receipt lines now format prices with the shared formatMoney and dates with dayjs.",
        partIds: [h.receiptFormatting],
        kind: "flow",
        via: [],
        entries: [],
        codeTitle: "formatDate",
        merged: [],
      },
      {
        id: TourStepId.parse("s4"),
        title: "The new dependency",
        explanation: "dayjs is added for the date format above.",
        partIds: [h.dependency],
        kind: "supporting",
        via: [],
        entries: [],
        codeTitle: "Other changes in the repository root",
        merged: [],
      },
    ],
    builtBy: "model",
  },
  warnings: [
    "Full file contents omitted for 1 file to fit the model's limit",
    "Couldn't fetch Jira tickets: Jira answered 503",
  ],
  usage,
  error: null,
  modelError: null,
  createdAt: "2026-10-21T09:42:10Z",
  updatedAt: "2026-10-21T09:43:02Z",
};

/** A complete analysis with nothing raised yet, seen by a reviewer who isn't the author. */
export const fixtureAnalysisView: AnalysisView = {
  analysis,
  pointReviews: [],
  publication: null,
  isAuthor: false,
  stale: false,
};
