# Stage 49: A judge that reads the whole PR, on the Claude plan

**Status:** Not started
**Depends on:** 47
**Owns:** `evals/judge.ts`, `evals/judge-verdict.ts`, `evals/harness.ts`, `evals/run.ts`, `evals/cost.ts`, `evals/README.md`; the structured-call export in `src/adapters/claude/`

## Read first

- [evals/README.md](../../evals/README.md) and `evals/judge.ts`: the judge as it is.
- [Stage 47](47-eval-noise-metrics.md): it adds the description block and the `restates-description` rating to the judge, which this stage builds on.
- `src/adapters/claude/claude-code-analysis-model.ts`, `claude-code-request.ts`, `claude-code-output.ts`, `claude-code-errors.ts`, `run-claude.ts`: how a pass runs through `claude -p`, and how its session is checked before its answer is trusted.
- ARCHITECTURE.md, *Credentials* and *Model passes*: why Claude Code runs without tools, settings or an API key, and where the PR data sits so the cache holds it.

## Goal

The judge has two limits that make the evals weaker and dearer than they need to be:

1. **It reads excerpts, not the PR.** It gets the expected items, what Claude produced, and at most 8 changed lines of each hunk Claude cited. It can't tell whether a finding is true when the proof is in code Claude didn't cite, an unchanged line or another file, so it rates real findings speculative and can't catch a wrong one that looks plausible in eight lines. On delphi-code #2 the rejected-token finding rests on a 401 branch outside every hunk.
2. **It runs on the API.** Every run costs money, about $2 for the 13 cases at excerpt size, and more once it reads whole PRs. The passes already run on the reviewer's Claude plan through Claude Code (stage 41); the judge doesn't, so even `--via claude-code` needs an API key and a bill.

This stage gives the judge the PR exactly as the passes read it, and runs it through Claude Code on the plan. With `--via claude-code`, a whole eval run then needs no API credentials and charges nothing per token.

## Decisions

- **The judge reads what the passes read.** The same `renderInput` text the model got: description, commits, tickets, every hunk without a proof in full, proved hunks as stats, the head content of files within the budget, and the call graph. The harness keeps the `AnalysisInput` of the run's first model call and hands it to the judge, rather than rebuilding it. Grading against the same input is fair: a finding is valid when that input supports it, and a miss is a miss of something the model could see. Rendering the files in the judge's own format was the alternative; it would let the judge and the passes see different things and drift apart.
- **The PR goes where the cache holds it.** As for the passes on Claude Code, the judge's instructions and then the PR data go in the system prompt file; the expected and produced items, and a retry's feedback, go on stdin. A retry then reads the PR from cache.
- **One structured call, shared with the passes.** The Claude adapter exports one function that runs a locked-down `claude -p` with a given model, effort, system prompt, schema and message, and returns the structured answer, its usage and the session's model. The pass model is rewritten on top of it, so the judge gets the same lockdown checks (no tools but `StructuredOutput`, no MCP servers, no API key in use on the plan) without a copy. The judge's prompt and schema stay in `evals/`. Calling `createRunClaude` from `judge.ts` with its own flags was the alternative; it would copy the lockdown, which is what keeps PR text from reaching anything that runs.
- **Still Opus, and checked.** The judge stays `claude-opus-5-5`, run with `--model`, so it's stronger than the Haiku it grades. The API path recorded the served model to catch a fallback grading in the judge's place; here the `system`/`init` event's `model` is read (`ClaudeCodeInit` gains it) and a session on any other model fails the case.
- **The API judge goes.** The judge runs only through Claude Code. Keeping both was the alternative; scores from two transports aren't comparable, the baseline would have to say which judged it, and the API path is the one that costs per token. `--via api` still runs the passes on the API.
- **Cost is still reported, as Claude Code estimates it.** The stream's `total_cost_usd` is what the run would cost at API prices; the summary shows it as that, like the review page's usage footer, so a reader can tell a heavy run from a light one. `--yes` still gates a run, since it spends the plan's usage limits.
- **Too large fails the case, never truncates.** The judge's prompt is the PR plus the items. It's checked with the adapter's estimate (`estimateTokens`) against `MAX_INPUT_TOKENS` before the call; a case over it is an error, not scored on a cut PR.

## Tasks

1. **Claude adapter.** Extract from `createClaudeCodeAnalysisModel` a function, exported from `src/adapters/claude/index.ts`, that runs one locked-down structured call: model, effort, system prompt text, JSON schema and stdin message in; the structured output, usage, Claude Code's version and the session's model out, or a `ModelError`. `claudeCodeArgs` takes the model and the schema instead of reading `MODEL` and `PASS_ANSWER_FORMAT`. The pass model calls it; its behavior and prompt fingerprints stay the same, so `CLAUDE_CODE_PROMPT_VERSION` doesn't move. Export `renderInput` and `estimateTokens` too. `ClaudeCodeInit` gains `model`, parsed from the init event.
2. **Harness.** `analyzeCase` wraps the model so it keeps the `AnalysisInput` of the first call, and returns it with the analysis. A case whose model never ran has none and isn't judged.
3. **Judge.**
   - The input is `renderInput(input)`, then the labels and the produced items as now, without `<hunk_excerpts>`. Stage 47's `<pull_request_description>` goes too, since the rendered PR holds the description and tickets.
   - The system prompt says the judge sees the pull request as the tool did, and rates against it: "speculative" becomes "not supported by the code in the pull request, or not actually a problem", and a produced item's lines can be checked against the hunk they name.
   - It runs through the adapter's structured call: `claude-opus-5-5`, effort medium, `JUDGE_VERDICT_SCHEMA`, the PR in the system prompt file, the items and any feedback on stdin. Validation, the one retry with what was wrong, and the model check stay as they are.
   - `JUDGE_VERSION` goes up by one from stage 47's.
4. **Runner** (`evals/run.ts`, `evals/cost.ts`):
   - The judge needs a signed-in Claude Code, checked with `claudeCodeStatus` before anything runs, with the same message `--via claude-code` gives today. An Anthropic key is needed only for `--via api`.
   - The estimate and the summary say the judge runs on the plan, with its cost at API prices.
   - Concurrency stays 3. If the plan's rate limit stops a case, it's an error with Claude Code's reason, as a failed pass is.
5. **README.** The run section says what each part runs on and needs; the judge's paragraph says it reads the whole PR.

## Not in this stage

- Changing what the passes see, or the prompts.
- Repeats per case, comparing prompt versions and the first baseline: the stage after the eval stages.
- Judging with a model other than Opus.

## Tests

- **Adapter:** the pass model's tests pass unchanged on top of the extracted call; the call fails a session that has a tool, an MCP server, an API key on the plan, or no init event; `ClaudeCodeInit` reads `model`.
- **Harness:** `analyzeCase` returns the input the fake model got first, and none when the model didn't run.
- **Judge** (with a fake `RunClaude` replaying stream lines, as the adapter's tests do): the system prompt file holds every hunk of the case and the head content the input had; the items and feedback are on stdin; a retry sends the same system prompt; a session on another model fails; an answer that doesn't fit the lists is retried once and then fails; an input over the limit fails before any call.
- **Runner:** without a signed-in Claude Code it stops before running anything, and with `--via claude-code` it asks for no API credentials.

## Definition of done

- [ ] The judge reads the whole PR as the passes did, and runs through Claude Code on Opus.
- [ ] The passes and the judge share one locked-down structured call; the passes' fingerprints didn't change.
- [ ] `node evals/run.ts --via claude-code` needs no API credentials.
- [ ] One case judged live (`--case small-feature --via claude-code --yes`) with its verdict, the session's model and the cost estimate recorded below. It runs on the plan; ask the user first.
- [ ] `pnpm check` passes.

## Open issues

- **Opus on the plan.** Whether the reviewer's plan runs `claude-opus-5-5` under `claude -p`, and how much of its usage a full run takes, is measured by the live case above. If the plan can't run Opus, stop and ask; don't fall back to another model silently.

## Notes for later stages

None yet.
