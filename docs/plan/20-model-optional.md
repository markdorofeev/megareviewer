# Stage 20: Model passes optional

**Status:** Not started
**Depends on:** 18, 19
**Unblocks:** 23
**Owns:** `src/application/use-cases/run-pipeline.ts`, `src/application/use-cases/pipeline-version.ts`, `src/cli/`

## Goal

An analysis is complete after prep, with risk from stage 18's rules and the tour from stage 19, and no model call. The model passes run only when the reviewer turns them on, and then improve what the page shows instead of producing it. Anthropic credentials become optional.

## Read first

- [ARCHITECTURE.md](../../ARCHITECTURE.md) "Analysis pipeline", "Credentials"
- `src/application/use-cases/run-pipeline.ts`, `src/cli/compose.ts`, `src/cli/doctor.ts`
- Stages 18 and 19

## Contract change

`StageStatus` gains `"skipped"`, for a model pass that didn't run because the model is off. A separate PR, with a line in stage 02's **Change log**. The progress strip shows skipped stages as such, and an analysis with skipped stages is `complete`.

## Tasks

1. **Turning it on.** `megareviewer --ai` runs the model passes; without the flag they're skipped. The flag is fixed for the server's lifetime, so one analysis never mixes runs with and without the model. A setting in the UI is the later alternative, and needs per-pass results in one analysis.
2. **Pipeline without the model.** After prep: risk is proof risk plus `classifyByRules`; the tour is `codeTour`; intent and decisions are empty; the four model stages are `skipped`. `fitToModel` isn't called, so a PR too large for the model still opens.
3. **Pipeline with the model.** As now, with two changes: a hunk is *contract* if the rules or the model say so, keeping both reasons; when the model's tour fails validation twice, the tour is `codeTour` instead of the file-order fallback.
4. **Cache key.** The pipeline version includes whether the model ran, so turning `--ai` on re-analyzes instead of reusing a model-free result.
5. **Credentials.** Startup and `doctor` require a git host only. Without Anthropic credentials, `--ai` fails at startup with the message `doctor` gives today.
6. **Docs.** DESIGN.md's "First slice" decision and ARCHITECTURE.md's pipeline, credentials and UI sections describe the model as optional, with the reason (the page has to work before any model call; each reviewer pays for model calls) and the rejected alternative (model always on).

## Tests

- Integration: with the model off, a PR from the fake host gives a complete analysis with rule risk, a code tour and four skipped stages, and the fake model gets no calls.
- With the model on: a rule contract survives a model *logic*; a failed model tour falls back to `codeTour`.
- The pipeline version differs with and without the model.
- `doctor` passes with only a git host; `--ai` without Anthropic credentials fails at startup.

## Definition of done

- [ ] Contract PR: `"skipped"` in `StageStatus`, change log line in stage 02.
- [ ] `--ai` flag; model-free pipeline; combined risk; code tour as the fallback.
- [ ] Anthropic credentials optional in startup and `doctor`.
- [ ] DESIGN.md and ARCHITECTURE.md updated in the same PR.

## Open issues

_None yet._

## Notes for later stages

_None yet._
