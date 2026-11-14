# Stage 52: OpenAI's models through Codex

**Status:** Not started
**Depends on:** 51
**Owns:** `src/adapters/model/codex/`, Codex's provider in `src/cli/model-access.ts` and `doctor.ts`, the OpenAI parts of `README.md` and `ARCHITECTURE.md`

## Goal

A reviewer with a ChatGPT plan and no Claude plan can't run the passes without paying per token. Codex is to a ChatGPT plan what Claude Code is to a Claude plan: a command the reviewer has installed and signed in to, which megareviewer can run without seeing a credential. This stage adds it as a provider, so its models are options when `codex` is installed and signed in, and disabled with the fix when it isn't.

## Measured

Codex CLI 0.162.0, signed in with ChatGPT, `gpt-6-luna` at low effort, from an empty directory, on 2026-11-14.

- **Detection.** `codex --version` prints `codex-cli 0.162.0`. `codex login status` exits 0 and prints "Logged in using ChatGPT". `codex debug models` prints the catalog as JSON, each model with `slug`, `display_name`, `visibility` (`list` or `hide`), `supported_reasoning_levels` and `context_window` (272,000 for every listed model).
- **The schema is accepted as it is.** `--output-schema` took the `PassAnswer` union, 4,274 bytes with its `anyOf`, and the answer parsed as the intent pass's.
- **Usage is reported.** The stream's `turn.completed` has `input_tokens`, `cached_input_tokens`, `cache_write_input_tokens`, `output_tokens` and `reasoning_output_tokens`. There's no cost.
- **The cache is shared across processes.** A later process with the same instructions read 6,912 of 8,672 input tokens from cache.
- **Codex's own instructions cost about 9,500 tokens a call,** and about 5,200 with `model_instructions_file` set to ours.
- **A call took 8 to 10 seconds.**
- **The tools can't all be turned off.** With `shell_tool`, `unified_exec`, `apps`, `plugins`, `hooks`, `multi_agent`, `browser_use`, `computer_use`, `in_app_browser`, `image_generation`, `view_image`, `goals`, `sleep_tool`, `tool_suggest` and `skill_search` disabled and web search off, the model still listed `exec`, `wait`, `request_user_input`, the `collaboration.*` agent tools and `clock.curr_time`. Disabling `code_mode_host` added `apply_patch` and the MCP resource tools.

Not measured: whether the read-only sandbox blocks the network, which sign-in wins when an API key is also in the environment, and the cache with a PR's worth of data.

## Decisions

- **Codex, not the OpenAI API.** Only Codex spends a ChatGPT plan, and it needs no credential handled by megareviewer. The API with a key is the fallback Claude has, and a later stage if someone asks: it's the one way to run OpenAI's models with no tools at all.
- **A tool call fails the pass.** Claude Code's lockdown is that the session has no tools. Codex can't promise that, so the rule here is that no tool runs unseen: the stream is read as it arrives, and any item that isn't the model's reasoning or its message kills the process and fails the pass with "the session used a tool; its answer was discarded". Under it, Codex runs in a new empty directory with the read-only sandbox, so a command that did start could read files but not change them, and what it read reaches only the model, whose answer is then thrown away. ARCHITECTURE.md's bound, that an injection can only distort the analysis, then holds if the sandbox also blocks the network, which task 1 checks before anything else is built. If it doesn't, this stage stops and the question goes to the user. Accepting the sandbox alone was the alternative; a command's output could then reach a finding the reviewer publishes.
- **Our instructions replace Codex's.** `model_instructions_file` holds the shared system prompt: it saves 4,300 tokens a call, and Codex's own tell the model to act as a coding agent.
- **The PR data leads the prompt.** OpenAI's cache is by prefix, so the PR goes first and the pass's task last, on stdin. Whether the instructions file or the prompt holds it, and whether one schema for all passes matters to the cache as it does on Claude, is measured in task 2 and decided there.
- **The user's Codex setup is left out of the run.** `--ignore-user-config` and `--ignore-rules` skip their config, MCP servers and rules, `project_doc_max_bytes=0` skips any `AGENTS.md`, and `--ephemeral` writes no session, so a review doesn't show up in the reviewer's Codex history.
- **Models come from Codex's catalog, narrowed to ours.** An option is a model in megareviewer's measured list that `codex debug models` shows with `visibility: "list"`. The catalog alone would list models the evals never ran on; our list alone would offer one the reviewer's account doesn't have.
- **Cost is an estimate at API prices, or absent.** Codex reports tokens, not cost. A model in the price table shows "≈ $0.02 at API prices, on your ChatGPT plan"; one that isn't shows its tokens and no figure. Claude's fallback to the highest known price doesn't carry over: another vendor's prices say nothing about this one's.
- **No new dependency.** `codex` is spawned without a shell, as `claude` and `git` are.

## The call

One process per pass, in a new empty temporary directory (mode 0700), removed afterwards with its files:

```
codex exec
  --model <slug>
  -c model_reasoning_effort=<the pass's>
  -c model_instructions_file=<tmp>/instructions.md
  --output-schema <tmp>/schema.json
  --sandbox read-only --cd <tmp>/work --skip-git-repo-check
  --ephemeral --ignore-user-config --ignore-rules
  -c web_search=disabled -c project_doc_max_bytes=0
  --disable <each feature under Measured>
  --json -
```

The prompt goes to stdin. The answer is the text of the last `agent_message` item, parsed as JSON and then with the same Zod schema as Claude's.

## Read first

- [41-claude-code-model.md](41-claude-code-model.md): the same design on Claude Code, and what its lockdown checks.
- [51-model-choice.md](51-model-choice.md): the catalog a provider plugs into.
- `src/adapters/model/claude/run-claude.ts`, `claude-code-output.ts`, `claude-code-errors.ts`, `claude-code-status.ts`.
- Codex's [non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), [CLI reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli), [config reference](https://learn.chatgpt.com/docs/config-file/config-reference) and [pricing](https://learn.chatgpt.com/docs/pricing) pages.

## Contract change

In its own PR first, with a line in stage 02's change log:

- `ModelUsage.costUsd` becomes nullable, for a model with no known price. The usage line and Run details show tokens alone then, and the run's total says "cost unknown for 2 calls" rather than summing around them.
- The usage line's "on your Claude plan" reads the provider's plan name from the run's option.

## Tasks

1. **The sandbox and the network, first.** With the call above and a prompt that asks for `curl` to a local listener, record whether the request arrives. Record too what the stream shows for a tool call: the item types seen, for the lockdown's list. Write both under **Measurements**. If the network is reachable, stop.
2. **The cache at size.** With delphi-code #2's rendered input, run two passes and record `cached_input_tokens` with the PR in the instructions file and with it leading stdin, and with one schema against a schema per pass. Pick the placement that caches; write the numbers down.
3. **`run-codex.ts`.** `RunCodex(args, options)`: spawn without a shell, write stdin, yield the stream's lines as they arrive so the lockdown can kill the process, time out at 10 minutes, and stop with the server. The environment keeps `CODEX_HOME` and drops `OPENAI_*` and `CODEX_*` otherwise, once task 1's run confirms a key in the environment would otherwise be used.
4. **`codex-request.ts`.** The arguments, the instructions file, the schema file and the stdin text of a pass, as pure functions of the input, the model and the pass.
5. **`codex-output.ts`.** Parse the stream with Zod: `thread.started`, `item.*` with its type, `turn.completed` with its usage, `turn.failed` and `error`. Unknown events are ignored; an unknown item type is a tool call, since the check fails safe.
6. **`codex-errors.ts`.** To `ModelError`, as Claude Code's table does: `codex` can't be started or isn't signed in (`unauthorized`, with the fix), the plan's limit (`rate-limited`), no response (`network`), the prompt too long (`too-large`), a refusal (`refusal`), a tool call or anything else (`unexpected`). The messages Codex gives for each are recorded as fixtures.
7. **`codex-status.ts`.** `codex --version`, `codex login status` and `codex debug models`, to: not installed, signed out, signed in on a plan or with an API key (`billing`), or failed. A version older than the one the fixtures were recorded on is disabled with `codex update`.
8. **`codex-analysis-model.ts`.** An `AnalysisModel` over `createPassModel`, with `checkSize` estimated from the prompt's bytes against the model's `context_window` less Codex's own tokens, calibrated on the eval cases as Claude Code's was. Its `version` is `codex/<slug>/pN`, with a fingerprint test over the arguments and prompts.
9. **The provider** in `model-access.ts` and `doctor.ts`: its options, their `via` ("Codex, on your ChatGPT plan" or "Codex, billed to your OpenAI account"), and its reasons when disabled.
10. **Evals.** Run the set on each candidate model through Codex; the judge stays Opus on Claude Code. A model is listed when its scores are recorded, by stage 51's rule. The prompt-injection case must score no worse than on Claude, and must not trip the lockdown into hiding an injection that worked: a pass failed for a tool call counts as the injection caught.
11. **Docs, in the same PR as the code.** ARCHITECTURE.md: a Codex row in *Credentials*, the provider in *Model passes* with its lockdown and why it differs from Claude Code's, the untrusted-content list. README.md: setup, and Privacy, which must say that with Codex the code goes to OpenAI under the reviewer's own plan and its settings.

## Not in this stage

- The OpenAI API with a key.
- Codex's `--oss` local providers. Local models come with opencode in stage 53.
- Signing in from megareviewer, or reading `~/.codex/auth.json`.
- Prompts of its own. If the shared prompts score badly on OpenAI's models, that's a stage after this one.

## Tests

- **Request:** the arguments for each pass and model; the cached part of the prompt is byte-identical across the five passes of one input.
- **Output:** fixtures recorded from real runs with a recorder left in `evals/`: success, signed out, a refusal. Synthetic, and named so: the plan's limit, prompt too long.
- **Lockdown:** a stream with a command item, an MCP call, a file change, a web search or an unknown item type fails the pass and kills the process before the stream ends; reasoning and message items don't.
- **Status:** each state from recorded output; a catalog without one of our models leaves that option out.
- **Contract:** the adapter passes `analysis-model-contract` on a fake `RunCodex`.
- **Environment:** the child gets `CODEX_HOME` and none of the dropped variables.

## Definition of done

- [ ] `pnpm check` passes.
- [ ] Task 1's and task 2's numbers are under **Measurements**, and the read-only sandbox blocks the network.
- [ ] On delphi-code #2 with only Codex signed in, all five passes complete on the ChatGPT plan, and the usage line says so.
- [ ] A PR whose description tells the model to run a command ends in a failed pass with the lockdown's reason, and nothing from that answer on the page.
- [ ] With Codex missing or signed out, its options are disabled with the fix.
- [ ] The eval scores of each listed model are in a report under `evals/reports/`.
- [ ] ARCHITECTURE.md and README.md updated as in task 11.

## Measurements

## Open issues

- **Whether OpenAI's terms allow a published tool to run `codex exec` on a reviewer's plan.** Their pricing page describes an API key as the way to automate in shared environments such as CI and says nothing about a local tool. Read the terms, and ask OpenAI before the release that ships this. Until then the README says megareviewer "runs your Codex".
- **A Codex update may add a tool-less mode,** or change what the feature flags remove. The version check keeps a newer Codex working only as far as its stream still shows every tool call; look for a documented way to remove the tools at each bump of the recorded version.
- **Windows,** as for Claude Code: `spawn("codex")` without a shell doesn't start a `.cmd` shim.

## Notes for later stages
