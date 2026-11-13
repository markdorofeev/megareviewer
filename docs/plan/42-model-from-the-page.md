# Stage 42: Claude from a button on the review

**Status:** Done (on main, no PR): checked live on delphi-code #2
**Depends on:** 41
**Owns:** `src/application/use-cases/` (the pipeline's split, the model run, recovery), `pipeline-version.ts`, `Analysis.modelError`, the model route and status in `contracts/`, `src/cli/` (`--ai` and `--ai-via` removed, availability), the button in `web/src/pages/review/`, the picker's setup row, `evals/harness.ts`

## Goal

The model is decided when the server starts: `--ai` runs the four passes on every analysis, and without it none can run until megareviewer is restarted. With stage 41 the passes run on the reviewer's own Claude plan, so asking for them costs nothing per review, but the reviewer still has to know the flag and restart to get them.

This stage drops `--ai` and `--ai-via`. Every analysis is the code's; a button on the review, "Analyze with Claude", runs the passes on that analysis, in place. The reviewer asks for the model on the PR in front of them, when they want it.

## Decisions

- **The passes add to the open analysis.** Intent, decisions, the model's risk and the tour's titles land on the analysis the reviewer is reading, so drafts, verdicts and the scroll stay. Starting the same PR's analysis with the model on, under another ID, was the alternative: smaller, but drafts are kept per analysis ID and wouldn't follow.
- **One analysis per PR, head commit and pipeline.** The model is no longer in the cache key: the pipeline version keeps `+checkout` and drops `+no-model` and the model's version. `PIPELINE_VERSION` goes to 17, so cached analyses run again once.
- **The model's failure isn't the analysis's.** The code's analysis completes after prep, with the four model stages `skipped`, meaning not run. A model run sets them running, done or failed, and a failure is `Analysis.modelError`, shown beside the button with Try again. The analysis stays complete, so the reviewer keeps commenting while the passes run.
- **The run rebuilds the model's input.** It collects again from the stored PR (its diff is stored; files come from `file_contents`, tickets from Jira again) and runs prep again, which is deterministic, then the passes. Keeping prep's output in memory was the alternative: lost on a restart, and a second copy of what the analysis already holds.
- **Claude Code first, else the API, with no flag.** Which one runs is picked as stage 41 picks it, when the status is first asked, and kept once one is available. While neither is, every status request checks again, so signing in to Claude Code works without a restart. `--ai-via` went with `--ai`: one path to explain.
- **An analysis is in progress while its code stages or the model run.** The events stream closes, and the page stops following, only when neither is running.

## Tasks

1. `pipelineVersion` without the model; `PIPELINE_VERSION` 17.
2. `Analysis.modelError: AnalysisError | null`, default null, and `inProgress(analysis)` in the domain.
3. The pipeline split: `runPipeline` ends after prep, model stages `skipped`; `runModel(id)` re-collects, preps and runs the passes, never changing `status`. One run per analysis at a time. Recovery fails a model stage left running by a stop.
4. `AppDeps.modelAvailability()` in place of `modelEnabled`: available with what runs and who pays, or why not.
5. Contract: `POST /api/analyses/:id/model`, and the status's `model` becomes `{ available, via, reason }`. Answers `model-unavailable` when neither can run, and `bad-request` unless the analysis is complete and its model stages aren't done or running.
6. CLI: `--ai` and `--ai-via` removed; compose picks the transport lazily; the startup line says what the button will run.
7. Page: the button in the header, its running and failed states, and the setup row.
8. Evals: the harness runs the model after the code's analysis.
9. Docs: DESIGN.md's "The model is optional", ARCHITECTURE.md, README.md.

## Notes for later stages

- **`src/cli/model-access.ts`** holds the transport's selection, moved out of `compose.ts`: `selectTransport`, `describeTransport`, `claudeCodeProblem`, `anthropicConfigured`, and `createModelAccess`, whose `model` runs each pass on the picked transport and whose `availability()` picks it. Callers that ask at once share one probe of Claude Code.
- **The model run starts after the code's run has left the in-flight map.** The code's run announces `done` before its promise settles, so a request to run the model at once waits for that tail instead of taking it for a run to join.
- **A model stage is in progress while it's pending, too.** Once the code's stages are done, a model stage is pending only while a run hasn't reached it, so `inProgress` counts it, and a run that ends early turns the stages it didn't reach back to `skipped`.
- **A risk pass that fails keeps the rules' risk,** where the old pipeline left the risk empty: the code's analysis already had it.
- **The page follows an analysis again without remounting it.** `useAnalysisView` gained `follow()`, which subscribes to its events again and keeps the view, so the reader keeps their place; the page's `restart()` remounts, for a retry of a failed analysis.
- **"You can give verdicts once the analysis is complete" is gone.** Decisions only come from a model run on a complete analysis, so they can always be given verdicts.
- **The mock API's failing PR fails at prep,** since only a code stage fails an analysis now; it simulates the model's stages straight after the code's, as if the button were pressed.
- **Unavailable, the button still shows.** Pressing it says why Claude can't run, read again at that moment, so a reviewer who signed in meanwhile isn't told stale news. Hiding it, or disabling it with a tooltip, was the alternative: a disabled button says nothing to a screen reader, and a reviewer who never sees it doesn't learn Claude is there.
