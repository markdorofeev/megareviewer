# Stage 41: The model through Claude Code, by default

**Status:** Not started
**Depends on:** 20, 31
**Owns:** `src/adapters/claude/` (new files beside the API ones), `src/cli/args.ts`, `compose.ts`, `doctor.ts`, `main.ts`, the model option of `evals/`, the Anthropic parts of `README.md` and `ARCHITECTURE.md`

## Goal

`--ai` needs an API key today, so every review is billed per token on top of the Claude plan most reviewers already pay for. The Messages API can't spend a plan: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and an `ant auth login` profile are all Console credentials.

Claude Code can. This stage runs the four passes through the reviewer's own installed, signed-in `claude`, as a subprocess, and makes that what `--ai` does by default. The API path stays, for reviewers without Claude Code and for the evals.

megareviewer never sees a credential on this path: it doesn't sign anyone in, read the keychain or send a token. Anthropic's terms forbid a third-party tool doing any of those with a plan's credentials, and allow a user to run the unmodified Claude Code binary signed in to their own plan.

## Measured

Claude Code 2.1.303, signed in to a Pro plan, `claude-haiku-5-5`, from an empty directory with a clean environment.

One call with the flags under [The call](#the-call):

- It ran on the plan: `apiKeySource` was `none`.
- The session had one tool, `StructuredOutput`, no MCP servers, no skills and no slash commands. Asked by the prompt to run `ls ~`, the model had nothing to run it with.
- The answer came back in `structured_output`, validated against the schema, in 2 turns and 4.0 s, 1.3 k tokens in all with the system prompt replaced.
- Nothing was left on disk: no session file, nothing in the working directory.

Sharing 30.5 k tokens of PR data between two processes, the second asking another question:

| Where the PR data is | Second process read from cache |
|---|---|
| The user message, one text | 0 |
| The user message, a block of its own (`--input-format stream-json`) | 0 |
| The system prompt file | 29,887 of 30,554 |

With the PR data in the system prompt:

| Change in the second process | Read from cache |
|---|---|
| `--effort` low → medium | 29,887 |
| Another `--json-schema` | 0 |
| Two processes at once, efforts high and low | 29,887 each |

## Decisions

- **Claude Code first, the API second.** `--ai` uses Claude Code when `claude` is on the PATH and signed in, else the API when the SDK finds credentials, else fails at startup naming both fixes. `--ai-via claude-code` or `--ai-via api` forces one and implies `--ai`. The startup line says which ran and who pays: "Claude Code, on your Pro plan" or "Anthropic API, billed to your account". Claude Code only, with the API behind a flag, was the alternative: it would break `--ai` for everyone set up with a key today.
- **The transport lives in `src/adapters/claude/`.** It shares the prompts, the input rendering and the output schema with the API transport, and `adapters-are-isolated` forbids one adapter importing another. The module is "the model passes on Claude", by either transport.
- **The PR data goes in the system prompt.** It's the only placement Claude Code caches across processes (see Measured), and without the cache each of the four passes pays for the whole PR. Its cost: PR text is untrusted and now sits where instructions do. The bound ARCHITECTURE.md gives still holds, since the session has no tools to misuse, so the worst an injection does is distort the analysis. The system prompt keeps its instructions first and says the block after them is data. Forking one saved session per pass was the alternative: it keeps the data in a user message, and writes the PR's code into `~/.claude/projects` as sessions the reviewer then sees in Claude Code.
- **One schema for all passes still.** The schema becomes the `StructuredOutput` tool, which sits before the system prompt, so a schema per pass would miss the cache every time (see Measured). Effort doesn't, so each pass sets its own with `--effort`.
- **The lockdown is checked on every call, not trusted.** The first event of the stream lists the session's tools and MCP servers. Anything but `StructuredOutput` alone and no servers kills the process and fails the pass. A Claude Code update that changes a flag's meaning then fails loudly instead of handing PR text a shell.
- **Credential variables are dropped from the child's environment.** With `ANTHROPIC_API_KEY` set, Claude Code uses the key instead of the plan (`claude auth status` here reported `apiKeySource: ANTHROPIC_API_KEY`), which would bill the API while the startup line says the plan.
- **Cost is shown as an estimate, not a bill.** On a plan nothing is charged per review; Claude Code reports what the tokens would cost at API prices. The usage footer says so (see Contract change).
- **No new dependency.** The Agent SDK package would wrap the same binary; spawning it, as the git adapter spawns `git`, needs nothing installed with megareviewer.

## The call

One process per pass, started without a shell in a new empty temporary directory (mode 0700), removed afterwards with the system prompt file:

```
claude -p
  --model claude-haiku-5-5
  --effort <the pass's>
  --system-prompt-file <tmp>/system.txt     SYSTEM_PROMPT, then the rendered PR data
  --json-schema <the PassAnswer union>
  --tools "" --strict-mcp-config --disable-slash-commands --setting-sources ""
  --no-session-persistence
  --max-turns 4                              the answer takes 2
  --output-format stream-json --verbose
```

The pass's message goes to stdin. The answer is `structured_output` of the last `result` event, parsed with the same Zod schema as the API's.

## Read first

- [08-claude-adapter.md](08-claude-adapter.md), [20-model-optional.md](20-model-optional.md), [31-model-tour-from-flows.md](31-model-tour-from-flows.md)
- `src/adapters/git/run-git.ts`, for running a command without a shell behind an injectable function
- Claude Code's [headless](https://code.claude.com/docs/en/headless), [CLI reference](https://code.claude.com/docs/en/cli-reference), [env vars](https://code.claude.com/docs/en/env-vars) and [legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) pages

## Contract change

In its own PR first, with a line in stage 02's change log:

- `ModelUsage` gains `billing: "api" | "plan"`, defaulting to `"api"` so stored analyses still parse. `costUsd` keeps its meaning under `"api"`; under `"plan"` it's the estimate at API prices.
- The usage footer reads it: "≈ $0.02 at API prices, on your Claude plan" instead of "$0.02".
- `ENGINEERING.md`'s language table is unchanged: billing isn't a review concept.

## Tasks

1. **`run-claude.ts`.** `RunClaude(args, options)`: spawn `claude` without a shell, write stdin, collect the stream's lines. It kills the process after 10 minutes, as the SDK times a request out today, and when the server closes. The environment is the server's without `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_BASE_URL`; check under a parent Claude Code session, which sets `CLAUDECODE` and `CLAUDE_CODE_*`, that the child still runs on the plan. Set the variables that turn off Claude Code's non-essential traffic, named on the env vars page.
2. **`claude-code-request.ts`.** The arguments, the system prompt text and the stdin message of a pass, as pure functions of the input. `--effort` from `PASS_EFFORT`; the schema from `PASS_ANSWER_FORMAT`.
3. **`claude-code-output.ts`.** Parse the stream with Zod into: the init event's tools and servers, the last rate limit event, the result's `structured_output`, `usage`, `total_cost_usd`, `is_error`, `api_error_status` and `stop_reason`. Unknown events and fields are ignored.
4. **`claude-code-errors.ts`.** To `ModelError`:

   | What happened | Kind | Message says |
   |---|---|---|
   | `claude` can't be started | `unauthorized` | Install Claude Code, or start with `--ai-via api` |
   | Not signed in | `unauthorized` | Run `claude` and sign in |
   | The plan's limit is reached | `rate-limited` | When it resets, from the rate limit event |
   | Overloaded, 5xx | `overloaded` | |
   | No response from the API | `network` | |
   | Stopped for a refusal, no `structured_output` | `refusal` | |
   | Cut off at the output limit | `max-tokens` | |
   | The prompt is too long | `too-large` | |
   | Tools or servers in the init event | `unexpected` | The session wasn't locked down; nothing was sent |
   | The timeout, or anything else | `unexpected` | The last line of stderr |

   Nothing is retried here: the pipeline retries a pass once on invalid output, as now.
5. **`claude-code-analysis-model.ts`.** `createClaudeCodeAnalysisModel({ run?, logger, maxInputTokens? })`, an `AnalysisModel`. `parseAnswer` moves out of `claude-analysis-model.ts` to be shared. `version` is `claude-code/claude-haiku-5-5/pN` with its own fingerprint test over the arguments and prompts, so an analysis made on one transport isn't served for the other.
6. **`checkSize` without token counting.** Claude Code has no count endpoint. Estimate from the system prompt's bytes, calibrated on the eval cases to err high (the filler measured here was 1.9 bytes a token, prose is nearer 4), against the same 400,000 budget; the CLI's own prompt-too-long is the backstop.
7. **Selection in `compose.ts`.** `claudeCodeStatus(run)`: `claude --version` and `claude auth status` (JSON: `loggedIn`, `authMethod`, `subscriptionType`), with the same environment as a pass. `--ai` picks as under Decisions; `Composition` says which transport and plan for the startup line. `args.ts` gains `--ai-via`, with usage text.
8. **`doctor`.** A "Claude Code" line: its version and plan, or how to install or sign in. The "Anthropic" line becomes "Anthropic API" and says it's the fallback. A version older than the one the fixtures were recorded on is a failed check that says `claude update`.
9. **Evals.** `evals/run.ts` takes `--via claude-code|api`, default `api`, so the baseline stays comparable. Run the set on both and record the scores.
10. **Docs, in the same PR as the code.** ARCHITECTURE.md: the Credentials row, the components table, Model passes (two transports, where the PR data sits on each and why), the untrusted-content list ("no tools" becomes "no tools; with Claude Code, checked on every call"), Model and cost. README.md: the Anthropic paragraph and Privacy, which must say that with Claude Code the code goes to Anthropic under the reviewer's own plan and its privacy settings.

## Not in this stage

- Signing in from megareviewer, or reading Claude Code's stored credentials.
- Another model per transport. Both stay on Haiku 5.5.
- Streaming a pass's text to the page. Passes report when they finish, as now.

## Tests

- **Request:** the arguments for each pass, and that the system prompt is byte-identical across the four passes of one input.
- **Output:** fixtures recorded from real runs with the recorder left in `evals/`: success, a refusal, not signed in. Synthetic, and named so: the plan's limit reached, overloaded, prompt too long.
- **Lockdown:** an init event with `Bash` in its tools, or a server, fails the pass and kills the process.
- **Contract:** the adapter passes `analysis-model-contract` on a fake `RunClaude`.
- **Selection:** Claude Code signed in; not installed with API credentials; neither; each `--ai-via`. `doctor`'s lines for each.
- **Environment:** the child never gets the three credential variables.

## Definition of done

- [ ] `pnpm check` passes.
- [ ] `megareviewer --ai` on delphi-code #2 with no API credentials set: all four passes complete on the plan, and the startup line and usage footer say so.
- [ ] The second pass onward reads the PR data from cache there; the numbers are in **Measurements**.
- [ ] The evals' scores through Claude Code are within the baseline's tolerance of the API's, or the difference is written down with the decision taken.
- [ ] A PR whose description tells the model to answer something else scores no worse through Claude Code than through the API.
- [ ] ARCHITECTURE.md and README.md updated as in task 10.

## Open issues

- **Whether a published tool may make this its default.** The terms forbid a third party offering Claude sign-in or routing requests through a plan's credentials, and allow a user running unmodified Claude Code on their own plan. This design is the second, but that's our reading. Ask Anthropic before the release that ships it; until then the README says megareviewer "runs your Claude Code", never "sign in with Claude".
- **Windows.** `spawn("claude")` without a shell doesn't start a `.cmd` shim. Check what the native installer puts on the PATH.
- **The output limit.** The API path asks for 64,000 tokens. Find how Claude Code sets it for `-p`, and whether a long tour answer is cut off sooner.
- **The plan's limits.** A large PR's four passes come out of the reviewer's 5-hour window. Measure delphi-code #2's share of a Pro window, and say it in the README if it's large.

## Notes for later stages
