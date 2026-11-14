// biome-ignore-all lint/suspicious/noTemplateCurlyInString: these strings are diff lines of TypeScript.
import type { FileChange } from "../../../domain/diff/index.ts";
import {
  type Analysis,
  type AnalysisKey,
  analysisId,
  CommentKey,
  DecisionId,
  FindingId,
  type Intent,
  type ModelCall,
  type ModelPass,
  type Publication,
  type Tour,
  TourStepId,
} from "../../../domain/review/index.ts";
import type { AnalysisInput, AnalysisInputFile } from "../../ports/index.ts";
import { fileChange, hunk } from "./builders.ts";
import { smallFeature } from "./small-feature.ts";

// The small-feature PR after diff parsing, and a complete analysis of it. None of its hunks is
// mechanical.

const rateLimitHunk = hunk("config/app.yaml", "@@ -10,7 +10,7 @@ database:", [
  " ",
  " rateLimit:",
  "   enabled: true",
  "-  perMinute: 60",
  "+  perMinute: 600",
  "   burst: 20",
  " ",
  " cache:",
]);

const cacheTtlHunk = hunk("config/app.yaml", "@@ -19,6 +19,7 @@ cache:", [
  "   ttlSeconds:",
  "     orders: 60",
  "     products: 300",
  "+    receipts: 3600",
  " ",
  " logging:",
  "   level: info",
]);

const receiptsConfigHunk = hunk("config/app.yaml", "@@ -28,3 +29,7 @@ logging:", [
  "     - cardNumber",
  "     - email",
  "     - phone",
  "+",
  "+receipts:",
  "+  currency: USD",
  '+  footer: "Thank you for shopping with Acme."',
]);

const importHunk = hunk("src/routes/orders.ts", "@@ -1,6 +1,7 @@", [
  ' import { Router } from "express";',
  ' import { requireUser } from "../auth.ts";',
  ' import { cancelOrder, findOrder, listOrders } from "../services/orders.ts";',
  '+import { renderReceipt } from "../services/receipts.ts";',
  " ",
  " export const ordersRouter = Router();",
  " ",
]);

const receiptRouteHunk = hunk(
  "src/routes/orders.ts",
  '@@ -28,3 +29,12 @@ ordersRouter.post("/orders/:id/cancel", async (req, res) => {',
  [
    "   }",
    "   res.status(204).end();",
    " });",
    "+",
    '+ordersRouter.get("/orders/:id/receipt", async (req, res) => {',
    "+  const order = await findOrder(req.user.id, req.params.id);",
    "+  if (!order) {",
    '+    res.status(404).json({ error: "not found" });',
    "+    return;",
    "+  }",
    '+  res.type("text/plain").send(renderReceipt(order));',
    "+});",
  ],
);

const receiptServiceHunk = hunk("src/services/receipts.ts", "@@ -0,0 +1,20 @@", [
  '+import type { Order } from "./orders.ts";',
  "+",
  "+const RECEIPT_TTL_MS = 60 * 60 * 1000;",
  "+const cache = new Map<string, { text: string; expiresAt: number }>();",
  "+",
  "+const formatCents = (cents: number): string => (cents / 100).toFixed(2);",
  "+",
  "+export function renderReceipt(order: Order, now: number = Date.now()): string {",
  "+  const cached = cache.get(order.id);",
  "+  if (cached && cached.expiresAt > now) {",
  "+    return cached.text;",
  "+  }",
  "+  const lines = order.items.map(",
  "+    (item) => `${item.quantity} x ${item.name}  ${formatCents(item.priceCents)}`,",
  "+  );",
  "+  const total = order.items.reduce((sum, item) => sum + item.quantity * item.priceCents, 0);",
  '+  const text = [`Receipt for order ${order.id}`, ...lines, `Total: ${formatCents(total)}`].join("\\n");',
  "+  cache.set(order.id, { text, expiresAt: now + RECEIPT_TTL_MS });",
  "+  return text;",
  "+}",
]);

export const smallFeatureFiles: readonly FileChange[] = [
  fileChange({ path: "config/app.yaml", status: "modified", language: "yaml" }, [
    rateLimitHunk,
    cacheTtlHunk,
    receiptsConfigHunk,
  ]),
  fileChange({ path: "src/routes/orders.ts", status: "modified", language: "typescript" }, [
    importHunk,
    receiptRouteHunk,
  ]),
  fileChange({ path: "src/services/receipts.ts", status: "added", language: "typescript" }, [
    receiptServiceHunk,
  ]),
];

const inputFile = (file: FileChange): AnalysisInputFile => ({
  path: file.path,
  oldPath: file.oldPath,
  status: file.status,
  language: file.language,
  mechanical: false,
  hunks: file.hunks,
  mechanicalHunks: [],
  headContent: smallFeature.headFiles[file.path] ?? null,
});

const { pullRequest } = smallFeature;

export const smallFeatureInput: AnalysisInput = {
  pullRequest: {
    title: pullRequest.title,
    description: pullRequest.description,
    sourceBranch: pullRequest.sourceBranch,
    targetBranch: pullRequest.targetBranch,
    commits: pullRequest.commits,
    url: pullRequest.url,
  },
  tickets: smallFeature.tickets,
  files: smallFeatureFiles.map(inputFile),
  callGraph: [
    {
      fromPartId: importHunk.id,
      toPartId: receiptServiceHunk.id,
      symbol: "renderReceipt",
      line: 4,
      use: "call",
    },
    {
      fromPartId: receiptRouteHunk.id,
      toPartId: receiptServiceHunk.id,
      symbol: "renderReceipt",
      line: 39,
      use: "call",
    },
  ],
};

const key: AnalysisKey = {
  ref: pullRequest.ref,
  headSha: pullRequest.headSha,
  pipelineVersion: "18",
};

export const smallFeatureIntent: Intent = {
  stated: {
    summary:
      "Let customers download a plain-text receipt for one of their orders, cached for a configurable time.",
    sources: [
      { kind: "description", ref: null },
      { kind: "ticket", ref: "SHOP-123" },
    ],
  },
  inferred: {
    summary:
      "Adds GET /orders/:id/receipt, which renders a receipt and caches it in memory for a hard-coded hour. Also raises the rate limit tenfold.",
    behaviorChanges: [
      "New endpoint GET /orders/:id/receipt returns a plain-text receipt for the user's own order, or 404.",
      "Receipts are cached in process memory for one hour, with no eviction.",
      "The rate limit goes from 60 to 600 requests per minute.",
    ],
  },
  mismatches: [
    {
      kind: "unrequested",
      description: "The rate limit is raised from 60 to 600 requests per minute.",
      hunkIds: [rateLimitHunk.id],
    },
    {
      kind: "missing",
      description:
        "The cache lifetime should be configurable. Config adds cache.ttlSeconds.receipts, but the code uses a hard-coded hour.",
      hunkIds: [cacheTtlHunk.id, receiptServiceHunk.id],
    },
  ],
};

const d = DecisionId.parse;
const s = TourStepId.parse;

const answered = (pass: ModelPass, startedAt: string, durationMs: number): ModelCall => ({
  pass,
  attempt: 1,
  startedAt,
  durationMs,
  outcome: "ok",
  problems: [],
  error: null,
});

export const smallFeatureAnalysis: Analysis = {
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
  },
  filesFetched: { done: 5, total: 5 },
  pullRequest,
  files: smallFeatureFiles,
  tickets: smallFeature.tickets,
  missingTicketKeys: [],
  proofs: [],
  parts: [],
  callGraph: smallFeatureInput.callGraph,
  callSites: [],
  fileLinks: [{ from: "src/routes/orders.ts", to: "src/services/receipts.ts" }],
  generated: [],
  checkout: "none",
  unchangedCallers: [],
  intent: smallFeatureIntent,
  findings: [
    {
      id: FindingId.parse("f1"),
      title: "Serves a stale receipt for an hour after its order changes",
      explanation:
        "The cache is keyed by order ID alone, so a refund or an edited item still shows the receipt rendered before it until the entry expires.",
      lines: { hunkId: receiptServiceHunk.id, side: "new", startLine: 9, line: 11 },
      severity: "major",
      suggestion: null,
      mismatch: null,
    },
  ],
  risk: [
    {
      hunkId: rateLimitHunk.id,
      riskClass: "contract",
      reason: "Changes the rate limit.",
      source: "model",
      lines: null,
    },
    {
      hunkId: cacheTtlHunk.id,
      riskClass: "contract",
      reason: "Adds a config setting.",
      source: "model",
      lines: null,
    },
    {
      hunkId: receiptsConfigHunk.id,
      riskClass: "contract",
      reason: "Adds a config section.",
      source: "model",
      lines: null,
    },
    {
      hunkId: importHunk.id,
      riskClass: "logic",
      reason: "Imports the new service.",
      source: "model",
      lines: null,
    },
    {
      hunkId: receiptRouteHunk.id,
      riskClass: "contract",
      reason: "Adds a public endpoint.",
      source: "model",
      lines: null,
    },
    {
      hunkId: receiptServiceHunk.id,
      riskClass: "logic",
      reason: "Renders and caches receipts.",
      source: "model",
      lines: null,
    },
  ],
  decisions: [
    {
      id: d("d1"),
      title: "Adds GET /orders/:id/receipt, scoped to the signed-in user's orders",
      category: "api",
      whyItMatters: "A new public endpoint is a contract clients will depend on.",
      hunkIds: [receiptRouteHunk.id, importHunk.id],
      lines: null,
    },
    {
      id: d("d2"),
      title: "Caches receipts in process memory with no eviction",
      category: "performance",
      whyItMatters: "The cache grows with every order viewed and isn't shared between instances.",
      hunkIds: [receiptServiceHunk.id],
      lines: null,
    },
    {
      id: d("d3"),
      title: "Raises the rate limit from 60 to 600 requests per minute",
      category: "configuration",
      whyItMatters: "Nobody asked for it, and it weakens abuse protection for every endpoint.",
      hunkIds: [rateLimitHunk.id],
      lines: null,
    },
    {
      id: d("d4"),
      title: "Hard-codes the receipt cache lifetime instead of reading config",
      category: "configuration",
      whyItMatters: "The ticket asks for a configurable lifetime, and the new setting is ignored.",
      hunkIds: [receiptServiceHunk.id, cacheTtlHunk.id],
      lines: null,
    },
  ],
  tour: {
    steps: [
      {
        id: s("s1"),
        title: "The new endpoint",
        explanation: "Requests for a receipt load the user's order and hand it to the renderer.",
        partIds: [receiptRouteHunk.id, importHunk.id],
        kind: "flow",
        via: [],
        entries: [receiptRouteHunk.id],
        codeTitle: "GET /orders/:id/receipt",
        merged: [],
      },
      {
        id: s("s2"),
        title: "Rendering and caching receipts",
        explanation: "The receipt is plain text, cached per order for an hour.",
        partIds: [receiptServiceHunk.id],
        kind: "flow",
        via: [],
        entries: [],
        codeTitle: "renderReceipt",
        merged: [],
      },
      {
        id: s("s3"),
        title: "Configuration",
        explanation: "New receipt settings, and an unrelated rate limit change.",
        partIds: [cacheTtlHunk.id, receiptsConfigHunk.id, rateLimitHunk.id],
        kind: "supporting",
        via: [],
        entries: [],
        codeTitle: "Other changes in config",
        merged: [],
      },
    ],
    builtBy: "model",
  },
  warnings: [],
  usage: [
    {
      pass: "intent",
      inputTokens: 6120,
      cacheReadTokens: 0,
      cacheWriteTokens: 5800,
      outputTokens: 410,
      costUsd: 0.07,
      billing: "api",
    },
    {
      pass: "risk",
      inputTokens: 380,
      cacheReadTokens: 5800,
      cacheWriteTokens: 0,
      outputTokens: 260,
      costUsd: 0.02,
      billing: "api",
    },
    {
      pass: "decisions",
      inputTokens: 420,
      cacheReadTokens: 5800,
      cacheWriteTokens: 0,
      outputTokens: 690,
      costUsd: 0.03,
      billing: "api",
    },
  ],
  modelCalls: [
    answered("intent", "2026-10-21T09:00:20Z", 9_400),
    answered("risk", "2026-10-21T09:00:30Z", 8_100),
    answered("decisions", "2026-10-21T09:00:30Z", 21_600),
  ],
  error: null,
  modelError: null,
  modelOption: {
    provider: "anthropic-api",
    providerName: "Anthropic API",
    model: "claude-haiku-5-5",
    modelName: "Haiku 5.5",
    family: "Claude",
  },
  createdAt: "2026-10-21T09:00:00Z",
  updatedAt: "2026-10-21T09:01:10Z",
};

/** The code's tour of the small-feature PR, which the fixture analysis's tour titles. */
export const smallFeatureSkeleton: Tour = {
  steps: (smallFeatureAnalysis.tour?.steps ?? []).map((step) => ({
    ...step,
    title: step.codeTitle ?? step.title,
    explanation: "Read by the code.",
    codeTitle: null,
  })),
  builtBy: "code",
};

/** A valid publication for the small-feature PR: a summary and one inline comment. */
export const smallFeaturePublication: Publication = {
  verdict: "request_changes",
  summary: "Please drop the rate limit change.",
  comments: [
    {
      key: CommentKey.parse("decision:d3"),
      path: "config/app.yaml",
      line: 13,
      side: "new",
      body: "**Rejected: Raises the rate limit from 60 to 600 requests per minute**\n\nOut of scope here.",
    },
  ],
};
