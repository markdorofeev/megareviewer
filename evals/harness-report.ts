// Compares what runs of the evals gave by how they read the harness, from their results files. Free:
// node evals/harness-report.ts <results.json>...
// Each file is one `node evals/run.ts` of its own --reader and --with-harness. See evals/README.md.

import { readFileSync } from "node:fs";
import { ArmFile, compareArms, showArms } from "./harness-arms.ts";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node evals/harness-report.ts <results.json>...");
  process.exit(1);
}
const arms = files.map((path) => ArmFile.parse(JSON.parse(readFileSync(path, "utf8"))));
console.log(showArms(compareArms(arms)));
