# Evals

Measure the model passes on a labeled golden set, so a prompt change is judged by numbers. Run them by hand whenever a prompt, schema or the model changes (ENGINEERING.md §7). CI never runs them, because they cost money or a plan's usage.

## Run

```bash
node evals/run.ts --baseline evals/baseline.json
```

That prints the estimated cost at API prices and stops. Add `--yes` to run, `--case <name>` (repeatable) for a subset, `--model <id>` to run the passes on another option's model, Sonnet 5.5, the product's default, without it (the estimate is still the baseline's model), `--effort low|medium|high` to run every pass at that effort instead of its own, and `--write-baseline` to replace `evals/baseline.json` with this run's scores.

| Part | Runs on | Needs |
|---|---|---|
| The passes | The signed-in Claude Code, on its plan, or with `--via api` the API, or with `--via codex` the signed-in Codex, GPT-6 Sol unless `--model` says otherwise | Anthropic credentials (`ANTHROPIC_API_KEY` or `ant auth login`) for the API; `codex login` for Codex |
| The judge | Always the signed-in Claude Code, on its plan | Claude Code signed in, checked before anything runs |

So by default a run needs no API credentials, and charges nothing per token: the run comes out of the plan's usage limits, and its cost is shown at API prices only to tell a heavy run from a light one. A case the plan's rate limit stops is an error with Claude Code's reason.

For the Claude Code transport, `node evals/record-claude-code.ts` records its fixtures from real runs, and `node evals/calibrate-claude-code.ts` measures the bytes per token its size estimate rests on. Both run on the signed-in Claude Code's plan. `node evals/record-codex.ts` and `node evals/calibrate-codex.ts` do the same for Codex, on its ChatGPT plan.

Each case runs through stage 10's real pipeline with the real Claude adapter and tree-sitter parser; its PR and tickets come from fakes. A Claude Opus 5.5 judge ([judge.ts](judge.ts)) matches the produced findings and mismatches against the labels and rates each produced finding. It reads the whole PR exactly as the passes did, the same rendered input, so it rates a finding against the code it rests on, in or outside the hunks it cites. It runs through the same locked-down `claude -p` as the passes, and a session on any model but Opus fails the case; a PR too large for its input fails the case too, rather than being cut. The full outputs go to `evals/results/<time>.json` (gitignored), and the summary compares each metric with the baseline and its target. A run worth keeping gets a write-up of its metrics in `evals/reports/<date>/`.

| Metric | Measures | Target |
|---|---|---|
| `findingRecall` | Must-have findings the judge finds among the produced ones | ≥ 90% |
| `findingNoise` | Produced findings the judge rates speculative or a nit | ≤ 20% |
| `findingPlaced` | Labeled findings found whose produced one rests on a hunk and lines the label names | ≥ 90% |
| `typeRight` | Labeled findings found whose produced one has the label's type | ≥ 85% |
| `unwantedFindings` | Findings produced on cases labeled `nothingWrong`, in total | 0 |
| `mismatchRecall` | Labeled mismatches found | ≥ 80% |
| `mismatchNamed` | Labeled findings that show a mismatch, both found, whose finding names that mismatch | tracked |
| `mismatchFalsePositives` | Mismatches produced on cases labeled with none, in total | ≤ 1 |
| `injectionResistance` | Injection reported, with the must-have findings as if it weren't there | 100% |
| `guidanceFollowed` | Preferences and guideline files labeled as raising something, with one of their labeled findings found and carrying their mark | ≥ 90% |
| `leftOutRight` | Findings labeled as covered by a Don't flag preference, absent or marked left out by it; and, on a run that could leave something out, must-have findings not marked left out | 100% |
| `guidanceWrong` | Marks on a finding the labels don't put under that preference or file, out of all marks | ≤ 10% |

A finding marked left out is folded on the page, so every metric above the guidance ones counts it as not produced.

A case can carry guidance, a reviewer's preferences and the repository's guideline files, which its run reads as a real one would: the preferences from the preference store, the files from the host at the PR's base commit. The three guidance metrics come from the marks the analysis kept, compared with the labels; the judge doesn't rate a mark, it only says which produced finding is which labeled one. On such a case the judge's prompt gains a section saying what the guidance is, so a finding that reports a breach of a guideline file's rule is rated valid; a case without guidance is judged by the prompt it always was.

`findingRecall` by the label's type and `findingNoise` by the produced one's come after the table.

A case can have files of its repository the PR doesn't change, in `files/outside/`. Its run then has a checkout holding them and the head files, so it reads the unchanged callers as a real one would, and the judge's prompt gains a section saying what they are, as it does for guidance.

A case can also carry a **harness**: files its guideline files import, which a run puts in the prompt, and files those link, which a pass can open on Claude Code. `--reader off` runs the same case without the reader, and `--reader index-alone` with the reader and the list of files but without the line that asks a pass to read before it answers, which the product writes after each task but the intent's. `--with-harness` attaches a large harness that speaks to none of them to every case without guidance, and `--runs <n>` repeats the selection. `node evals/harness-report.ts <results>...` then compares the results files, free, by case, model and reader:

| Score | Measures | Target |
|---|---|---|
| `harnessFollowed` | Labeled marks of an imported or a linked file that came back on its ref | – |
| `harnessWrong` | Marks of a guideline file on a point the labels don't put there, out of all marks of one | none |
| `harnessRead` | Labeled reads that happened, by the pass and the file | – |
| Reads a run | By pass, uses of the read tool that gave something, the runs with any, and refusals | tracked |
| Quoted from outside | Runs whose answers hold words of the file a PR asks for outside the harness | none |
| What was spent | A run's tokens, cost at API prices and time, beside the same case with `--reader off` | tracked |
| Targets lost | Metrics that meet their target on the cases without the large harness and miss it with it attached | none |

Runs an hour apart or less read each other's prompt cache, so compare tokens, fresh and cached together, before cost. The judge reads a case's linked file as the rule the labels are about, whichever the reader, and a case with the large harness attached as it was judged without. A case that asks for a file outside writes one made-up line under `/tmp/megareviewer-eval` before it runs, and leaves it there.

The summary ends with how many of each rating the judge gave, so a change in noise says which kind moved. Then each case's time, slowest first: the analysis, split into the code's stages (prep) and each pass's calls added up, retries included, and the judge's. The findings start when the intent ends, so a case waits on the two.

A case whose analysis fails or times out, or whose judge fails, is reported as an error and left out of the scores.

## The guardrail call

```bash
node evals/run-guardrails.ts
```

The call a model run makes after its passes, which marks each finding a check could catch, has a golden set of its own in [guardrail-cases.ts](guardrail-cases.ts): a case is the call's input, the run's points with their code, the check configs and the build files, with the pull request's changed paths and a label for every point, the guardrails it accepts or none. Add `--yes` to run it on the signed-in Claude Code with Sonnet 5.5, one call a case. The answer goes through the server's own checks, `guardrailOf` with the case's configs and changed paths, the first mark on a point that exists standing, and what they keep is scored without a judge ([guardrail-score.ts](guardrail-score.ts)); the passes' cases don't run, since the call changes nothing they read.

| Metric | Measures | Target |
|---|---|---|
| `guardrailRight` | Labeled guardrails a point got as one its label accepts: a verified rule of its tool with a listed name, or a suggested check of a listed kind | ≥ 90% |
| `guardrailWrong` | Marks on points labeled none, and verified rules no accepted guardrail of their point lists, out of all marks kept | none |

## Add a case

1. Make `cases/<name>/` with `files/base/` and `files/head/` holding the changed files, and a `case.ts` with the PR's metadata (copy one). Or import a public GitHub PR: `GITHUB_TOKEN=$(gh auth token) node evals/import-pr.ts <url> <name>`.
2. For a synthetic case, write its diff: `node evals/make-diff.ts <name>`.
3. List its hunks with `node evals/print-hunks.ts <name>` (free: it uses the fake model) and write `labels.ts`: the findings (what looks wrong, its type, the hunks and lines that show it, the index of the mismatch it shows, and which ones a reviewer must see), and the expected mismatches (`[]` means none). A case labeled with neither measures noise; `nothingWrong` says besides that any finding on it is wrong.
4. For a case with guidance, export `guidance` from `case.ts`: the preferences in the order a run numbers them (`p1`, `p2`, …, everywhere's before the repository's) and the guideline files, which stay out of `files/`, in the order of `GUIDELINE_PATHS` (`g1`, …) with the files they import after them in `imported`, and the files those link in `linked`, nearest a root first, with the `rule` the judge reads of a long one; `print-hunks.ts` lists both with their refs. In the labels' `guidance`, say what each should do, by its ref: `raised` with the labeled findings it should lead to, one of which is enough, or `left-out` with those it covers, none of them a must-have; `alsoOn` lists the findings that may carry its mark without being asked to. A preference that should do nothing gets no label, so any mark of it is wrong. In the labels' `reads`, say which pass should open which linked file.
5. For a case an unchanged caller is part of, put the files of its repository the PR doesn't change in `files/outside/`, and export `checkoutFiles` from `case.ts`.
6. Register it in [cases/index.ts](cases/index.ts). `pnpm test` checks the diff, that every labeled finding is on lines its hunk shows, the tickets, and that the guidance labels name refs the run has, with an effect it would keep.

Changing a label, the judge prompt (bump `JUDGE_VERSION`) or the case set makes scores incomparable with the baseline: run again and write a new one.
