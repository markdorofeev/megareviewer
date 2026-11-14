# Evals

Measure the model passes on a labeled golden set, so a prompt change is judged by numbers. Run them by hand whenever a prompt, schema or the model changes (ENGINEERING.md §7). CI never runs them, because they cost money.

## Run

```bash
node evals/run.ts --baseline evals/baseline.json
```

That prints the estimated cost and stops. Add `--yes` to run, `--case <name>` (repeatable) for a subset, `--write-baseline` to replace `evals/baseline.json` with this run's scores, and `--via claude-code` to run the passes through the signed-in Claude Code instead of the API, which the baseline was measured on. The judge always calls the API, so it needs Anthropic credentials (`ANTHROPIC_API_KEY` or `ant auth login`).

For the Claude Code transport, `node evals/record-claude-code.ts` records its fixtures from real runs, and `node evals/calibrate-claude-code.ts` measures the bytes per token its size estimate rests on. Both run on the signed-in Claude Code's plan.

Each case runs through stage 10's real pipeline with the real Claude adapter and tree-sitter parser; its PR and tickets come from fakes. A Claude Opus 5.5 judge ([judge.ts](judge.ts)) matches the produced findings, decisions and mismatches against the labels and rates each produced finding and decision. The full outputs go to `evals/results/<time>.json` (gitignored), and the summary compares each metric with the baseline and its target.

| Metric | Measures | Target |
|---|---|---|
| `contractRecall` | Hunks labeled contract that the page shows as a risk. A miss is the worst model failure | ≥ 95% |
| `riskAccuracy` | Hunks labeled logic or contract shown as labeled: a risk is contract, anything else logic | ≥ 85% |
| `riskNoise` | Risks on hunks labeled logic, out of risks on hunks labeled logic or contract | ≤ 20% |
| `riskPlaced` | Risks on hunks with a `riskAt` that land on lines it names: the model's own lines, or the first changed line its band falls back to | ≥ 90% |
| `findingRecall` | Must-have findings the judge finds among the produced ones | ≥ 90% |
| `findingNoise` | Produced findings the judge rates speculative or a nit | ≤ 20% |
| `findingPlaced` | Labeled findings found whose produced one rests on a hunk and lines the label names | ≥ 90% |
| `decisionRecall` | Must-have decisions the judge finds among the produced ones | ≥ 90% |
| `decisionNoise` | Produced decisions the judge rates trivial, restating the code or the description, or asking for a change | ≤ 20% |
| `mismatchRecall` | Labeled mismatches found | ≥ 80% |
| `mismatchNamed` | Labeled findings that show a mismatch, both found, whose finding names that mismatch | tracked |
| `mismatchFalsePositives` | Mismatches produced on cases labeled with none, in total | ≤ 1 |
| `injectionResistance` | Injection reported, with risk and must-have findings and decisions as if it weren't there | 100% |
| `firstTryValid`, `fallbacksUsed` | Risk and tour passes valid without a retry; cases needing a fallback | tracked |

The risk metrics read the risks the page shows, which are the model's contract: a hunk only the path rules mark contract counts as logic, and a hunk labeled `"either"` counts in none of them. The summary ends with how many of each rating the judge gave, so a change in noise says which kind moved.

A case whose analysis fails or times out, or whose judge fails, is reported as an error and left out of the scores.

## Add a case

1. Make `cases/<name>/` with `files/base/` and `files/head/` holding the changed files, and a `case.ts` with the PR's metadata (copy one). Or import a public GitHub PR: `GITHUB_TOKEN=$(gh auth token) node evals/import-pr.ts <url> <name>`.
2. For a synthetic case, write its diff: `node evals/make-diff.ts <name>`.
3. List its hunks with `node evals/print-hunks.ts <name>` (free: it uses the fake model) and write `labels.ts`: a risk class for every hunk without a mechanical proof (`"either"` when it could fairly go both ways), by the risk prompt's rule that contract means a mistake would break or expose something outside the PR; for every contract hunk, `riskAt`, the lines its risk is about; the findings (what looks wrong, the hunks and lines that show it, and the index of the mismatch it shows), the decisions (why the code makes a choice, each a question starting with "Why"), which of both a reviewer must see, and the expected mismatches (`[]` means none).
4. Register it in [cases/index.ts](cases/index.ts). `pnpm test` checks the diff, that every hunk is labeled and every contract hunk has a `riskAt` on lines it shows, the labels' hunk IDs and the tickets.

Changing a label, the judge prompt (bump `JUDGE_VERSION`) or the case set makes scores incomparable with the baseline: run again and write a new one.
