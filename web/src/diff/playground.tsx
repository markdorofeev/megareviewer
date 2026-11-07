// biome-ignore-all lint/suspicious/noTemplateCurlyInString: these strings are diff lines of TypeScript.
import "./playground.css";
import { type ReactNode, useState } from "react";
import {
  type FileChange,
  findMechanicalProofs,
  type Hunk,
  type HunkId,
  type MechanicalProof,
  type PartId,
  parseUnifiedDiff,
} from "../../../src/domain/diff/index.ts";
import type { RiskAssessment, RiskClass } from "../../../src/domain/review/index.ts";
import { DiffView, type HunkItem } from "./DiffView.tsx";
import { FileNotices } from "./FileNotices.tsx";
import { MechanicalGroup } from "./MechanicalGroup.tsx";

// Every case the diff view has to render, at /dev/diff. The diff is parsed and proved by the
// domain code, as on the server; risk is hand-written.

const hunk = (oldStart: number, newStart: number, lines: readonly string[], heading = "") => {
  const count = (kinds: string) => lines.filter((line) => kinds.includes(line.charAt(0))).length;
  const header = `@@ -${oldStart},${count(" -")} +${newStart},${count(" +")} @@`;
  return [heading === "" ? header : `${header} ${heading}`, ...lines];
};

const modified = (path: string) => [
  `diff --git a/${path} b/${path}`,
  "index 1111111..2222222 100644",
  `--- a/${path}`,
  `+++ b/${path}`,
];

const added = (path: string) => [
  `diff --git a/${path} b/${path}`,
  "new file mode 100644",
  "index 0000000..3333333",
  "--- /dev/null",
  `+++ b/${path}`,
];

const deleted = (path: string) => [
  `diff --git a/${path} b/${path}`,
  "deleted file mode 100644",
  "index 4444444..0000000",
  `--- a/${path}`,
  "+++ /dev/null",
];

const LONG_VALUE = "x".repeat(1200);

const twoThousandLines = Array.from({ length: 1900 }, (_, i) =>
  i % 20 === 10
    ? [
        `-  total += items[${i}].priceCents;`,
        `+  total += items[${i}].priceCents * items[${i}].quantity;`,
      ]
    : [`   checks.push(validate(items[${i}], "item ${i}"));`],
).flat();

const lockfileLines = Array.from({ length: 700 }, (_, i) =>
  i < 3
    ? `   lockfileVersion: '9.${i}'`
    : `+  /pkg-${i}@1.0.${i}: {resolution: {integrity: sha512-${i}}}`,
);

const DIFF = [
  ...modified("src/routes/orders.ts"),
  ...hunk(
    12,
    12,
    [
      ' ordersRouter.get("/orders", requireUser, async (req, res) => {',
      "-  const orders = await listOrders(req.user.id);",
      "-  res.json(orders.map(toResponse));",
      "+  const orders = await listOrders(req.user.id, { limit: req.query.limit ?? 50 });",
      "+  res.json({ items: orders.map(toResponse), next: orders.at(-1)?.id ?? null });",
      " });",
    ],
    "export const ordersRouter = Router();",
  ),
  ...hunk(
    30,
    30,
    [
      " const receiptTemplate = (order: Order) => `",
      "   Order ${order.id}",
      "-  Total: ${order.totalCents}",
      "+  Total: ${formatMoney(order.totalCents, order.currency)}",
      "   Thank you!",
      " `;",
      " ",
      "-export default ordersRouter;",
      "\\ No newline at end of file",
      "+export { ordersRouter as default };",
      "\\ No newline at end of file",
    ],
    "const receiptTemplate = (order: Order) => `",
  ),
  ...added("src/lib/retry.ts"),
  ...hunk(0, 1, [
    "+/** Calls `fn` up to `attempts` times, waiting longer after each failure. */",
    "+export const retry = async <T>(fn: () => Promise<T>, attempts = 3): Promise<T> => {",
    "+  for (let attempt = 1; ; attempt++) {",
    "+    try {",
    "+      return await fn();",
    "+    } catch (error) {",
    "+      if (attempt === attempts) throw error;",
    "+      await sleep(2 ** attempt * 100);",
    "+    }",
    "+  }",
    "+};",
  ]),
  ...deleted("src/legacy/session.ts"),
  ...hunk(1, 0, [
    '-import { cookies } from "./cookies.ts";',
    "-",
    '-export const sessionId = (): string | null => cookies().get("sid") ?? null;',
  ]),
  "diff --git a/src/auth/token.ts b/src/auth/credentials.ts",
  "similarity index 84%",
  "rename from src/auth/token.ts",
  "rename to src/auth/credentials.ts",
  "index 5555555..6666666 100644",
  "--- a/src/auth/token.ts",
  "+++ b/src/auth/credentials.ts",
  ...hunk(4, 4, [
    " export const readToken = (storage: Storage): string | null =>",
    '-  storage.getItem("token");',
    '+  storage.getItem("token") ?? sessionStorage.getItem("token");',
  ]),
  ...modified("scripts/release.xyz"),
  ...hunk(1, 1, [
    " step build",
    "-step publish --tag next",
    "+step publish --tag latest --provenance",
  ]),
  ...modified("config/app.ini"),
  ...hunk(1, 1, [" [server]\r", "-port = 8080\r", "+port = 9090\r", " host = 127.0.0.1\r"]),
  ...hunk(9, 9, ["-[cache]", "+[cache]\r", " ttl = 60\r"], "[server]"),
  ...modified("data/catalog.json"),
  ...hunk(2, 2, [
    `-  "description": "${"A sturdy oak table. ".repeat(30)}",`,
    `+  "description": "${"A sturdy oak table with a lacquered top. ".repeat(15)}",`,
    `   "blob": "${LONG_VALUE}",`,
    `-  "tags": ["furniture", "oak", "table"]`,
    `+  "tags": ["furniture", "oak", "table", "dining"]`,
  ]),
  ...modified("src/checkout/validate.ts"),
  ...hunk(100, 100, twoThousandLines, "export const validateCart = (items: Item[]) => {"),
  ...modified("package.json"),
  ...hunk(8, 8, ['   "dependencies": {', '-    "pg": "8.16.0"', '+    "pg": "8.16.3"', "   }"]),
  ...modified("pnpm-lock.yaml"),
  ...hunk(1, 1, lockfileLines),
  ...modified("src/lib/strings.ts"),
  ...hunk(3, 3, [
    " export const trimLines = (text: string): string =>",
    '-  text.split("\\n").map((line) => line.trim()).join("\\n");  ',
    '+  text.split("\\n").map((line) => line.trim()).join("\\n");',
  ]),
  ...modified("src/lib/dates.ts"),
  ...hunk(
    20,
    20,
    [
      " ",
      "-export const startOfDay = (date: Date): Date => {",
      "-  const copy = new Date(date);",
      "-  copy.setHours(0, 0, 0, 0);",
      "-  return copy;",
      "-};",
      " ",
    ],
    "export const formatDate = (date: Date): string =>",
  ),
  ...modified("src/lib/time.ts"),
  ...hunk(5, 5, [
    " export const HOUR = 3_600_000;",
    "+",
    "+export const startOfDay = (date: Date): Date => {",
    "+  const copy = new Date(date);",
    "+  copy.setHours(0, 0, 0, 0);",
    "+  return copy;",
    "+};",
  ]),
  ...modified("src/config/limits.ts"),
  ...hunk(1, 1, [
    "-export const LIMITS = { maxItems: 100, maxOrders: 20 };",
    "+export const LIMITS = {",
    "+  maxItems: 100,",
    "+  maxOrders: 20,",
    "+};",
  ]),
  "diff --git a/docs/setup.md b/docs/getting-started.md",
  "similarity index 100%",
  "rename from docs/setup.md",
  "rename to docs/getting-started.md",
  "diff --git a/assets/logo.png b/assets/logo.png",
  "index 7777777..8888888 100644",
  "Binary files a/assets/logo.png and b/assets/logo.png differ",
  "diff --git a/scripts/deploy.sh b/scripts/deploy.sh",
  "old mode 100644",
  "new mode 100755",
  "diff --git a/.keep b/.keep",
  "new file mode 100644",
  "index 0000000..e69de29",
]
  .map((line) => `${line}\n`)
  .join("");

const parsed = parseUnifiedDiff(DIFF);
if (!parsed.ok)
  throw new Error(`playground diff: line ${parsed.error.line}: ${parsed.error.message}`);
const files: readonly FileChange[] = parsed.value;

const fileAt = (path: string): FileChange => {
  const file = files.find((candidate) => candidate.path === path);
  if (file === undefined) throw new Error(`playground: no file ${path}`);
  return file;
};

const hunkAt = (path: string, index: number): Hunk => {
  const found = fileAt(path).hunks[index];
  if (found === undefined) throw new Error(`playground: no hunk ${index} in ${path}`);
  return found;
};

const limits = hunkAt("src/config/limits.ts", 0);
const proofs: readonly MechanicalProof[] = [
  ...findMechanicalProofs(files, {
    gitattributes: null,
    baseContents: new Map(),
    headContents: new Map(),
  }),
  // A formatting proof needs syntax trees from tree-sitter, which the browser doesn't have.
  {
    path: limits.path,
    hunkId: limits.id,
    kind: "formatting",
    detail: "formatting only: syntax tree unchanged",
  },
];
const proved = new Set(proofs.flatMap((proof) => (proof.hunkId === null ? [] : [proof.hunkId])));

const assess = (target: Hunk, riskClass: RiskClass, reason: string): RiskAssessment => ({
  hunkId: target.id,
  riskClass,
  reason,
  source: "model",
});

const item = (path: string, index: number, riskClass: RiskClass, reason: string): HunkItem => ({
  hunk: hunkAt(path, index),
  file: fileAt(path),
  risk: assess(hunkAt(path, index), riskClass, reason),
});

const items: readonly HunkItem[] = [
  item("src/routes/orders.ts", 0, "contract", "Changes the response shape of GET /orders."),
  item("src/routes/orders.ts", 1, "logic", "Formats the receipt total as money."),
  item("src/lib/retry.ts", 0, "logic", "New retry helper with exponential backoff."),
  item("src/legacy/session.ts", 0, "logic", "Removes the cookie session reader."),
  item("src/auth/credentials.ts", 0, "contract", "Falls back to a token in session storage."),
  item("scripts/release.xyz", 0, "logic", "Publishes releases under the latest tag."),
  item("config/app.ini", 0, "contract", "Moves the server to port 9090."),
  item("config/app.ini", 1, "logic", "Changes one line's ending to CRLF."),
  item("data/catalog.json", 0, "logic", "Rewrites a product description."),
  item("src/checkout/validate.ts", 0, "logic", "Counts quantities in cart totals."),
  {
    hunk: limits,
    file: fileAt(limits.path),
    risk: {
      hunkId: limits.id,
      riskClass: "mechanical",
      reason: "formatting only",
      source: "proof",
    },
  },
];

const risk: readonly RiskAssessment[] = [
  ...proofs.flatMap((proof): RiskAssessment[] =>
    proof.hunkId === null
      ? []
      : [{ hunkId: proof.hunkId, riskClass: "mechanical", reason: proof.detail, source: "proof" }],
  ),
  ...items.map((entry) => entry.risk).filter((assessment) => !proved.has(assessment.hunkId)),
];

const mechanicalFiles = files.filter((file) => proofs.some((proof) => proof.path === file.path));

const Case = ({ title, children }: { readonly title: string; readonly children: ReactNode }) => (
  <section className="diff-playground-case">
    <h2>{title}</h2>
    {children}
  </section>
);

export default function DiffPlayground() {
  const [focused, setFocused] = useState<PartId | null>(null);
  const [highlighted, setHighlighted] = useState<ReadonlySet<PartId>>(
    () => new Set([hunkAt("src/routes/orders.ts", 0).id, hunkAt("src/auth/credentials.ts", 0).id]),
  );
  const index = items.findIndex((entry) => entry.hunk.id === focused);
  const move = (step: number) =>
    setFocused(items[(index + step + items.length) % items.length]?.hunk.id ?? null);

  return (
    <div className="diff-playground">
      <h1>Diff view</h1>
      <p className="muted">
        Click a card or use the buttons to focus a hunk; the highlight button marks the focused one,
        as stage 15 marks the hunks of a selected decision.
      </p>
      <div className="diff-playground-controls">
        <button type="button" className="button" onClick={() => move(-1)}>
          Previous hunk
        </button>
        <button type="button" className="button" onClick={() => move(1)}>
          Next hunk
        </button>
        <button
          type="button"
          className="button"
          disabled={focused === null}
          onClick={() =>
            setHighlighted((ids) => {
              const next = new Set(ids);
              if (focused !== null && !next.delete(focused)) next.add(focused);
              return next;
            })
          }
        >
          Toggle highlight
        </button>
        <span className="muted">
          Focused: {focused === null ? "none" : (items[index]?.hunk.path ?? "none")}
        </span>
      </div>
      <Case title="Hunks">
        <DiffView
          items={items}
          highlightedHunkIds={highlighted}
          focusedHunkId={focused}
          onFocusHunk={setFocused}
        />
      </Case>
      <Case title="Mechanical">
        <MechanicalGroup files={mechanicalFiles} proofs={proofs} risk={risk} />
      </Case>
      <Case title="File notices">
        <FileNotices files={files} />
      </Case>
    </div>
  );
}
