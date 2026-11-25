import {
  type CheckoutCommits,
  type PullRequestFixture,
  smallFeature,
} from "../../application/testing/index.ts";
import { pullRequestUrl, Sha } from "../../domain/review/index.ts";

const MONEY_PATH = "src/lib/money.ts";
const OLD_LINE = "export const formatCents = (cents: number): string => (cents / 100).toFixed(2);";
const NEW_LINES = [
  'export const formatCents = (cents: number, currency = "USD"): string =>',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: it's the fixture's code.
  "  `${(cents / 100).toFixed(2)} ${currency}`;",
];

const moneyDiff = [
  `diff --git a/${MONEY_PATH} b/${MONEY_PATH}`,
  "index 4c1f9a2..b7d0e61 100644",
  `--- a/${MONEY_PATH}`,
  `+++ b/${MONEY_PATH}`,
  "@@ -1 +1,2 @@",
  `-${OLD_LINE}`,
  ...NEW_LINES.map((line) => `+${line}`),
  "",
].join("\n");

const ref = { ...smallFeature.pullRequest.ref, number: 107 };
const headSha = Sha.parse("7d1c5a90b3e84f6621aa08c4f9be35d71e602c18");

/**
 * small-feature with a changed function that code outside the PR calls, on the fake server only:
 * the shared fixture is every test's and every eval's. No clone on the machine has its head commit,
 * so with `--download` its callers come once the repository is downloaded.
 */
export const receiptsDownloaded: PullRequestFixture = {
  ...smallFeature,
  name: "receipts-downloaded",
  pullRequest: {
    ...smallFeature.pullRequest,
    ref,
    url: pullRequestUrl(ref),
    title: `${smallFeature.pullRequest.title}, with callers`,
    headSha,
    diff: `${moneyDiff}${smallFeature.pullRequest.diff}`,
  },
  baseFiles: { ...smallFeature.baseFiles, [MONEY_PATH]: `${OLD_LINE}\n` },
  headFiles: { ...smallFeature.headFiles, [MONEY_PATH]: `${NEW_LINES.join("\n")}\n` },
};

const INVOICE = `import { formatCents } from "./lib/money.ts";

export const invoiceLine = (name: string, cents: number): string => {
  const price = formatCents(cents);
  return \`\${name}: \${price}\`;
};
`;

/** The repository at receipts-downloaded's head commit, as its host has it. */
export const downloadedCommits: CheckoutCommits = {
  [headSha]: { ...receiptsDownloaded.headFiles, "src/invoice.ts": INVOICE },
};
