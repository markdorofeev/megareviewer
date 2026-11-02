// Imports a public GitHub PR as an eval case: node evals/import-pr.ts <pr-url> <case-name>
// with GITHUB_TOKEN set (e.g. GITHUB_TOKEN=$(gh auth token)). Writes files/base, files/head,
// diff.patch (GitHub's diff) and pull-request.json into evals/cases/<case-name>/. Write
// case.ts and labels.ts by hand afterwards; print-hunks.ts lists the hunks to label.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGitHubHost } from "../src/adapters/github/index.ts";
import { parseUnifiedDiff } from "../src/domain/diff/index.ts";
import { parsePullRequestUrl } from "../src/domain/review/index.ts";
import { quietLogger, systemClock } from "./harness.ts";

const [url, name] = process.argv.slice(2);
const token = process.env.GITHUB_TOKEN;
if (url === undefined || name === undefined || token === undefined) {
  console.error("Usage: GITHUB_TOKEN=… node evals/import-pr.ts <github-pr-url> <case-name>");
  process.exit(1);
}
const ref = parsePullRequestUrl(url);
if (!ref.ok || ref.value.repo.host !== "github") {
  console.error(`Not a GitHub PR URL: ${url}`);
  process.exit(1);
}

const host = createGitHubHost({
  token,
  version: "eval-import",
  clock: systemClock,
  logger: quietLogger((line) => console.error(line)),
});
const pr = await host.getPullRequest(ref.value);
if (!pr.ok) throw new Error(pr.error.message);
const files = parseUnifiedDiff(pr.value.diff);
if (!files.ok) throw new Error(files.error.message);

const caseDir = fileURLToPath(new URL(`./cases/${name}/`, import.meta.url));
const write = (path: string, content: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};
const fetchTo = async (side: "base" | "head", sha: string, path: string) => {
  const contents = await host.getFiles(ref.value.repo, [{ sha, path }]);
  if (!contents.ok) throw new Error(`${path}@${sha}: ${contents.error.message}`);
  const [content] = contents.value;
  if (typeof content === "string") write(join(caseDir, "files", side, path), content);
};

for (const file of files.value) {
  if (file.binary) continue;
  if (file.status !== "added") await fetchTo("base", pr.value.baseSha, file.oldPath ?? file.path);
  if (file.status !== "deleted") await fetchTo("head", pr.value.headSha, file.path);
}
write(join(caseDir, "diff.patch"), pr.value.diff);
const { diff: _, ...withoutDiff } = pr.value;
write(join(caseDir, "pull-request.json"), `${JSON.stringify(withoutDiff, null, 2)}\n`);
console.log(`Imported ${files.value.length} files into ${caseDir}`);
