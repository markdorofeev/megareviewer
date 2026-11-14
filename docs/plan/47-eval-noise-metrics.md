# Stage 47: Evals that see noise and placement

**Status:** Not started
**Depends on:** 45
**Owns:** `evals/` except `evals/cases/delphi-account-connections/` (stage 48)

## Read first

- [evals/README.md](../../evals/README.md): how the evals run, the metrics and their targets, how a case is labeled.
- `evals/labels.ts`, `evals/score.ts`, `evals/judge.ts`, `evals/judge-verdict.ts`, `evals/cases.test.ts`.
- `pointsOf` in `src/domain/review/point.ts`: what the page shows as a risk, and on which lines.
- ARCHITECTURE.md, Model passes: the paragraph on what the risk and decisions passes leave out, and why.

## Goal

The risk and decisions prompts changed to cut noise (commits `cc9384a` and `16b579c` on `main`). On delphi-code #2 the risk pass went from 25 risks to 7 or 8, risks moved from the first changed line of their hunk to the lines they're about, and the decisions stopped repeating the PR description. None of that shows in the evals:

1. **Risk noise is free.** `riskAccuracy` scores only labeled hunks, and most hunks have no label: `large-retry-after` has 52 hunks and 8 labels. A model that marks every unlabeled hunk contract loses nothing.
2. **Where a risk lands isn't scored.** Findings have `findingPlaced`; risks have nothing.
3. **A decision that repeats the description scores as meaningful.** The judge's ratings are meaningful, trivial, restates-code and requests-change, and it never sees the description.
4. **Contract is scored from the wrong class.** `contractRecall` and `riskAccuracy` read the risk after the path rules raise it, but the page shows only the model's contract (DESIGN.md, *Each kind of point its own weight and place*). A hunk a rule raised counts for the model.

This stage makes all four measurable. It doesn't run the paid evals or write a baseline; stage 48 adds the case these metrics matter most on.

## Decisions

- **Score what the reviewer sees.** Risk metrics read the risk points `pointsOf` builds: the model's contract, on the lines it lands on. The rules' contract is internal and never shown, so it doesn't count for or against the model.
- **Every hunk the risk pass classifies gets a label.** A hunk that could fairly go either way is labeled `"either"` rather than left out, so an unlabeled hunk is a test failure, not a free pass. `"either"` counts in no risk metric.
- **A contract hunk's label says where its band belongs.** The lines the reason is about: the route, not the imports above it. Several places may be listed; a risk is placed when its lines overlap any of them, as `findingPlaced` does for findings.
- **The judge sees the description.** It needs it to rate a decision as repeating it. The description is untrusted PR text, so it goes in the judge's data block, escaped like the rest.
- **The new rating follows the prompt's own rule.** The decisions prompt keeps a choice whose consequence the reviewer has to accept even when it was asked for (a breaking change, a new public surface, a default, a limit, a lifetime), so the judge does too: such a decision is meaningful even when the description states it.

## Tasks

1. **Labels** (`evals/labels.ts`):
   - `RiskLabel` becomes `"logic" | "contract" | "either"`.
   - `FindingPlace` is renamed `LinePlace`, since risks use it too.
   - `CaseLabels` gains `riskAt: Readonly<Record<string, readonly LinePlace[]>>`: for each hunk labeled contract, where its band belongs. Every contract hunk has an entry.
   - The doc comment on `risk` changes from "At least every contract hunk; hunks that could go either way are left out" to every hunk the risk pass classifies.
2. **Label the existing cases.** Every case in `evals/cases/` (all 13, including the fixture cases whose labels live there) gets a label on every hunk the risk pass sees, which `node evals/print-hunks.ts <case>` lists, and `riskAt` on every contract hunk. Label by the rule the risk prompt now states (ARCHITECTURE.md, Model passes): contract only where a mistake would break or expose something outside the PR; a hunk that only follows from another (a new endpoint's models, a generated client or schema, a router's registration, a caller passing a new argument) and an interface whose every end is in the PR are logic. Keep every existing label unless it contradicts that rule; where you change one, say why in a comment beside it.
3. **Case checks** (`evals/cases.test.ts`):
   - Every hunk the risk pass would classify has a risk label. The test already analyzes each case with the fake model; the hunks without a mechanical proof are the ones the pass sees.
   - Every `riskAt` key is labeled contract, every contract label has a `riskAt` entry, and every place is on lines its hunk shows (`hunkHasLine`, as findings are checked).
4. **Metrics** (`evals/score.ts`), from `pointsOf(analysis)`'s risk points:
   - `contractRecall`: hunks labeled contract that are risk points.
   - `riskAccuracy`: hunks labeled logic or contract whose shown class matches (a risk point is contract, anything else logic).
   - `riskNoise`, new: risk points on hunks labeled logic, out of risk points on hunks labeled logic or contract. Target ≤ 20%.
   - `riskPlaced`, new: risk points on hunks with a `riskAt` entry whose landed lines (`point.lines`, on the same side) overlap one of its places. Target ≥ 90%, as `findingPlaced`.
   - Add both to `CaseScore`, `Summary`, `summarize`, `TARGET_METRICS`, `TARGETS`, and to the run's printed summary in `evals/run.ts`.
5. **Judge** (`evals/judge.ts`, `evals/judge-verdict.ts`):
   - The input gains `<pull_request_description>`: the PR's title and description and each ticket's key and summary, escaped with `escapeTags`, and named in the system prompt's list of untrusted blocks.
   - `DECISION_RATINGS` gains `"restates-description"`, described in the system prompt as: carries out what the description or a ticket already says and explains, so a reader of the description learns nothing from it, and has no consequence the reviewer has to accept (a breaking change, a new public surface, a default, a limit, a lifetime). A decision with such a consequence is "meaningful" even when the description states it.
   - `decisionNoise` already counts every rating but meaningful, so it counts the new one with no change. The run's output prints how many of each rating there were, so a reader can tell which kind of noise moved.
   - `JUDGE_VERSION` goes to 3.
6. **README** (`evals/README.md`): the metrics table gains `riskNoise` and `riskPlaced`, `contractRecall` and `riskAccuracy` say they read the shown risk, and step 3 of *Add a case* says every hunk gets a label (`"either"` when it could go both ways) and every contract hunk a `riskAt`.

## Not in this stage

- Running the paid evals, repeats per case, comparing prompt versions, and writing `evals/baseline.json`. The next stage after 48 does that, on the full case set.
- The delphi-code #2 case: stage 48.
- A report of how often the reviewer raises or dismisses each kind of point, from their own database.
- Changing the prompts. If labeling turns up a hunk the prompt's rule can't decide, note it under **Notes for later stages**.

## Tests

- **Score** (`evals/score.test.ts`): a risk point on a logic hunk counts as noise; one on an `"either"` hunk counts nowhere; a hunk a path rule raised but the model left logic is neither recall nor noise for the model; `riskPlaced` counts a risk on its labeled lines, misses one that fell back to the hunk's first changed line outside every place, and leaves out risk points on hunks without `riskAt`.
- **Judge** (`evals/judge.test.ts`): the input holds the escaped description and ticket summaries; a verdict with `"restates-description"` parses and counts as decision noise.
- **Cases** (`evals/cases.test.ts`): the new checks above, passing on every case.

## Definition of done

- [ ] Every hunk of every case is labeled, and every contract hunk has a `riskAt`.
- [ ] `riskNoise` and `riskPlaced` are in the scores, the summary and the README.
- [ ] The judge rates `restates-description`, at `JUDGE_VERSION` 3.
- [ ] `node evals/run.ts` without `--yes` prints its estimate and runs nothing; no paid run is needed for this stage.
- [ ] `pnpm check` passes.

## Open issues

None yet.

## Notes for later stages

None yet.
