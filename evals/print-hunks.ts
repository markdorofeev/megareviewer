// Lists a case's hunks as the pipeline sees them, to write its labels:
// node evals/print-hunks.ts <case>
// Runs the real diff parsing, proofs and parser with the fake model, so it's free and offline.

import { fileURLToPath } from "node:url";
import { createTreeSitterCodeParser } from "../src/adapters/treesitter/index.ts";
import { FakeAnalysisModel } from "../src/application/testing/index.ts";
import { evalCase } from "./cases/index.ts";
import { analyzeCase, quietLogger } from "./harness.ts";

const LINES = 4;

const name = process.argv[2];
const found = name === undefined ? undefined : evalCase(name);
if (found === undefined) {
  console.error("Usage: node evals/print-hunks.ts <case>");
  process.exit(1);
}

const parser = await createTreeSitterCodeParser({
  grammarsDir: fileURLToPath(new URL("../src/adapters/treesitter/grammars", import.meta.url)),
});
const result = await analyzeCase(found.fixture, {
  model: new FakeAnalysisModel(),
  parser,
  logger: quietLogger((line) => console.error(line)),
  timeoutMs: 60_000,
});
if (!result.ok || result.value.analysis.status !== "complete") {
  console.error(result.ok ? result.value.analysis.error : result.error);
  process.exit(1);
}
const { analysis } = result.value;
const proofOf = new Map(analysis.proofs.map((proof) => [proof.hunkId, proof]));

for (const file of analysis.files) {
  console.log(`\n${file.path} (${file.status}${file.language ? `, ${file.language}` : ""})`);
  for (const proof of analysis.proofs.filter((p) => p.path === file.path && p.hunkId === null)) {
    console.log(`  file-level proof: ${proof.kind}: ${proof.detail}`);
  }
  for (const hunk of file.hunks) {
    const proof = proofOf.get(hunk.id);
    const label = found.labels.risk[hunk.id];
    console.log(
      `  ${hunk.id} @@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines}` +
        (proof === undefined ? "" : ` · mechanical: ${proof.kind}`) +
        (label === undefined ? "" : ` · labeled ${label}`),
    );
    const changed = hunk.lines.filter((line) => line.kind !== "context");
    for (const line of changed.slice(0, LINES)) {
      console.log(`      ${line.kind === "add" ? "+" : "-"}${line.text.slice(0, 100)}`);
    }
    if (changed.length > LINES) console.log(`      … ${changed.length - LINES} more`);
  }
}
for (const warning of analysis.warnings) console.log(`\nwarning: ${warning}`);
