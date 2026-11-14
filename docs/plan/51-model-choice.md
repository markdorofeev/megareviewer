# Stage 51: A choice of model, among what's installed

**Status:** Not started
**Depends on:** 42, 45
**Owns:** `src/adapters/claude/` moved to `src/adapters/model/`, `src/cli/model-access.ts`, `compose.ts`, `doctor.ts`, the model's part of `src/application/use-cases/status.ts` and `analyses.ts`, the model routes in `src/adapters/http/`, `web/src/pages/review/ClaudeElement.tsx` and the strings that name the model, the model option of `evals/`

## Goal

Every review runs on one model, Haiku 5.5, a constant in `src/adapters/claude/request.ts`. Reviewers differ: one wants a stronger model and has the plan for it, another has only a ChatGPT plan, a third runs local models. This stage makes the model a choice the reviewer makes on the page, among the options their machine can run, and builds the list the next two stages add Codex and opencode to. It ships with Claude's models only.

## Decisions

- **An option is a model on a provider.** A provider is what runs the passes and decides who pays: Claude Code, the Anthropic API, and later Codex and opencode. The same model on two providers is two options, since the bill differs. One list of models with the provider picked for them, as today, was the alternative: it hides who pays, which is what a reviewer chooses by.
- **The page lists every option megareviewer knows, enabled or not.** One that can't run is disabled, stays focusable, and says why and the fix ("Codex isn't installed", "Claude Code isn't signed in: run `claude` and sign in"), as the locked Request AI review does now. Hiding them was the alternative: a reviewer would never learn that signing in to Codex adds options.
- **Chosen on the button, kept per browser.** Request AI review becomes a split button: the button runs the current choice, and the arrow beside it opens the list, grouped by provider. The choice is kept in the browser's local storage, as the Display menu's are, and sent with the run. Without one, the server's default is used: the first enabled option, in the order Claude Code, the Anthropic API, then the later providers, which is today's behavior. A settings page was the alternative; it's a page for one field, away from where the choice matters.
- **The run records its option.** The analysis keeps the provider and model of its model run, the usage line names them ("Sonnet 5.5 through Claude Code, on your Pro plan"), and Run details shows them. Remove AI review and a new run is how another model is tried on the same PR; nothing new is needed for it.
- **The page names the model that ran.** "Claude is reading this PR", "Claude's severity" and the like read the run's model family from the analysis, so they're right when stage 52 adds another. Neutral wording ("the model") was the alternative; it's vaguer on a page whose points the reviewer has to weigh by who made them.
- **A model is listed once the evals have run on it.** The prompts were tuned on Haiku, and a wrong finding costs the reviewer more than a missed one. Each listed model has its scores in a report under `evals/reports/`. Listing every model the provider serves was the alternative.
- **The module becomes "the model passes".** `src/adapters/claude/` moves to `src/adapters/model/`: what every provider shares (prompts, input rendering, output schema, `pass-model.ts`) in `shared/`, and Claude's two transports in `claude/`. `adapters-are-isolated` forbids one adapter importing another, and stages 52 and 53 need the shared parts. Stage 41 kept the module as "the model passes on Claude" for the same rule; a second provider is what changes it. Copying the prompts into each adapter was the alternative.
- **Detection is asked of each provider, at once.** Each provider answers its own status and its options; the list is their answers together, probed in parallel with a timeout each, so a hung command can't hold the page. A provider that can run is kept for the process, and one that can't is asked again on every status request, so signing in needs no restart, as now.

## Read first

- [41-claude-code-model.md](41-claude-code-model.md), [42-model-from-the-page.md](42-model-from-the-page.md), [44-review-bar.md](44-review-bar.md)
- `src/cli/model-access.ts`: how the transport is picked and kept today.
- `src/adapters/claude/request.ts`, `claude-code-request.ts`, `version.ts`, `pricing.ts`: every place that assumes one model.
- ARCHITECTURE.md, *Credentials* and *Model passes*.

## Contract change

In its own PR first, with a line in stage 02's change log and the new terms in ENGINEERING.md's language table:

| Term | Meaning |
|---|---|
| Model provider | What runs the model passes and decides who pays: Claude Code, the Anthropic API, Codex, opencode |
| Model option | A model on a provider, which the reviewer can choose when its provider can run it, with the reason when it can't |

- **Port.** `ModelAvailability` and the single `AnalysisModel` in the use cases' deps give way to a `ModelCatalog`: `options()` returns every `ModelOption` (`id`, `provider`, `model`, both display names, `via`, `measured`, and `available` or a `reason`), and `model(optionId)` returns the `AnalysisModel` for one. A fake catalog goes in `src/application/testing/`.
- **Domain.** The analysis gains the option of its model run (provider and model, with their display names), absent on stored analyses, which were all Haiku 5.5. `ModelUsage` and `ModelCall` are unchanged.
- **HTTP.** `Status.model` becomes `{ options, defaultId }`; `runModel` takes `{ optionId }`, or nothing for the default, and answers `bad-request` for an unknown ID and `model-unavailable`, with the option's reason, for a disabled one.

## Tasks

1. **Move the module,** as a PR of its own that changes no behavior: `src/adapters/claude/` to `src/adapters/model/shared/` and `src/adapters/model/claude/`, with imports and the dependency rules updated. The prompt fingerprints don't move.
2. **The model as a parameter.** The Claude Code transport already takes one, for the evals, and names it in its version (`claudeCodeVersion`). The API transport gets the same: `buildRequest` and `VERSION` take the model, and `MODEL` stays only as the default's name. Per model, in one table: its ID, display name, price, input budget, output limit under each transport, and the efforts it accepts. Prices come from the claude-api skill's table when the stage is done, not from memory. A pass whose effort a model doesn't accept runs at the nearest one it does.
3. **Claude's options.** Haiku 5.5, Sonnet 5.5 and Opus 5.5 on Claude Code and on the Anthropic API. Each provider reports its status once and its options from it. Whether a plan serves a model isn't known before the call, so a refusal is the run's `modelError` with Claude Code's reason.
4. **`ModelCatalog` in `model-access.ts`.** It replaces the pick-once transport: providers probed in parallel, 5 seconds each, their options joined in the order under Decisions.
5. **Use cases and routes.** `runModel` takes the option, records it on the analysis, and runs the passes on `catalog.model(optionId)`. `getStatus` returns the options. Error messages name the model that ran.
6. **The split button** in `ClaudeElement.tsx`: the menu from `web/src/ui`, options grouped by provider, each with its `via` line, a disabled one with its reason as its description, and an "unmeasured" chip where `measured` is false. The button's tooltip names the model as well as who pays. With every option disabled, the button is locked as today, with the default's reason. The bar's one row doesn't wrap: the arrow is 24 px wide and the button's label stays.
7. **The model's name on the page.** The strings that say Claude for "the model that ran" read the analysis's option; before a run, they read the current choice.
8. **`doctor`.** One line per provider, as its two Claude lines are now, each listing the models it would offer.
9. **Evals.** The comparison is done: `evals/reports/2026-11-14/` has Haiku 5.5, Sonnet 5.5 and Opus 5.5 through Claude Code, one run each, with Sonnet meeting 9 of 12 targets, Haiku 7 and Opus 8 at high effort. All three are listed on those scores. What's left is the default: Sonnet finds more and says less that's wrong, and costs more of a plan's limits, so whether it replaces Haiku as the default is decided here, with the reason in ARCHITECTURE.md. `evals/run.ts --model` takes an option's model ID as it does now.
10. **Docs, in the same PR as the code.** ARCHITECTURE.md: *Credentials*, *Model passes* (the model is the reviewer's choice, Haiku the default and why), *Model and cost*, the bar's Claude slot. DESIGN.md: the decision above on listing disabled options, under *The model is optional*.

## Not in this stage

- Providers other than Claude's: stages 52 and 53.
- A model per pass. One option runs all five.
- Prompts per model. The prompts stay as they are; a model that needs its own isn't listed yet.
- Showing a run's cost before it runs. The usage line says it after.

## Tests

- **Catalog:** every combination of Claude Code signed in, signed out, too old or missing with API credentials present or not gives the options and default expected; a provider that hangs past its timeout is disabled with that reason and doesn't delay the others.
- **Requests:** each model's arguments and request on both transports; the system prompt is byte-identical across the five passes of one input and one model.
- **Use case:** a run with an unknown option, with a disabled one, and with none; the analysis records the option; a stored analysis without one still parses.
- **Contract:** each Claude transport passes `analysis-model-contract` for each model.
- **UI:** the menu's groups, a disabled option's reason on focus and for screen readers, the choice surviving a reload, a stored choice that's no longer enabled falling back to the default, and the page's wording after a run.
- **Design system page:** the split button in its states, in all four theme combinations.

## Definition of done

- [ ] `pnpm check` passes.
- [ ] On delphi-code #2, a run on Sonnet 5.5 through Claude Code completes, and the usage line and Run details name it.
- [ ] Remove AI review, then a run on Haiku 5.5, works on the same analysis, and its points replace the first run's.
- [ ] With Claude Code signed out and no API credentials, every option is disabled with its fix, and signing in enables them without a restart.
- [ ] The eval scores of each listed model are in a report under `evals/reports/`.
- [ ] ARCHITECTURE.md, DESIGN.md and ENGINEERING.md updated as above.

## Open issues

- **Which models each Claude plan serves through Claude Code.** If a plan refuses a model, its option should say so before the reviewer tries. `claude auth status` gives the plan's name; whether that's enough to tell isn't known.

## Notes for later stages
