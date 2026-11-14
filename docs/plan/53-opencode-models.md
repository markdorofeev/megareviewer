# Stage 53: Models through opencode

**Status:** In progress (branch `claude/stage-53-ed2c4f`)
**Depends on:** 51, 52
**Owns:** `src/adapters/model/opencode/`, opencode's provider in `src/cli/model-access.ts` and `doctor.ts`, the opencode parts of `README.md` and `ARCHITECTURE.md`

## Goal

opencode is one command in front of many model providers: a reviewer who uses it has already connected the ones they pay for, local models among them. This stage adds it as a provider, so every model the reviewer's opencode can reach is an option, without megareviewer learning each vendor's API or holding any of their keys.

Nothing here has been run. opencode wasn't installed where this was planned, and its docs leave out most of what the design needs, so the stage starts with a spike that can end it.

## From the docs, not checked

Read on 2026-11-14; the server and SDK pages say they describe opencode V1.

- `opencode run --model provider/model "<prompt>"` runs one prompt without the interface. No flag for a JSON schema is documented.
- `opencode serve --port <n> --hostname 127.0.0.1` starts an HTTP server, with basic auth when `OPENCODE_SERVER_PASSWORD` is set, and its OpenAPI spec at `/doc`.
- `GET /provider` returns `{ all, default, connected }`, and `GET /config/providers` each provider's models.
- `POST /session`, then `POST /session/:id/message` with `{ model: { providerID, modelID }, system?, tools?, parts }`, answers when the model has.
- Structured output is a `format: { type: "json_schema", schema, retryCount }` field on that prompt, documented for the SDK's v2 client; the result is `info.structured`, and a failure is a `StructuredOutputError`. The model answers through a `StructuredOutput` tool.
- Permissions are ordered rules of `action`, `resource` and `effect`, the last match winning, so a final rule denying everything should leave the model no tool. The docs don't say so in those words.

Not documented: the flags of `opencode models` and `opencode auth list`, token usage and cost per message, and how to keep a run from loading the project's config, `AGENTS.md`, plugins and MCP servers.

## Decisions

Each holds only if the spike confirms what it rests on.

- **The server, not `opencode run`.** Structured output and the list of connected providers are documented only on the HTTP API. One `opencode serve` is started on the first use, on `127.0.0.1` with a random port and a random password, and stopped with megareviewer. A process per pass with `opencode run`, as for Claude Code and Codex, was the alternative: without a schema the answer would be JSON by request only, checked by Zod and retried more often.
- **`fetch`, not the SDK.** The calls are four routes; `@opencode-ai/sdk` would be a runtime dependency in a package that installs none.
- **Detection is the server's own answer.** `opencode --version` says it's installed; the options are the models of the providers `GET /provider` lists as `connected`. megareviewer never reads opencode's stored credentials.
- **Every option is unmeasured.** The models are whatever the reviewer connected, and the evals can't run on all of them, so stage 51's rule can't hold here. They're listed with the "unmeasured" chip instead, and the README says what that means. Listing only models measured elsewhere was the alternative; it would leave out local models, which are the reason to use opencode.
- **Models that Claude Code or Codex also offer stay listed here too.** The bill differs: opencode uses the reviewer's API keys.
- **The lockdown is the same rule as Codex's.** A config megareviewer passes denies every tool, and the answer's parts are checked: anything but text, reasoning and the `StructuredOutput` call fails the pass and discards the answer.
- **Cost is whatever opencode reports,** as an estimate if it gives one and absent if it doesn't, using stage 52's nullable `costUsd`. megareviewer keeps no price table for models it can't enumerate.

## Read first

- [51-model-choice.md](51-model-choice.md), [52-codex-models.md](52-codex-models.md)
- opencode's [CLI](https://opencode.ai/docs/cli.md), [server](https://opencode.ai/docs/server.md), [SDK](https://opencode.ai/docs/sdk.md), [permissions](https://opencode.ai/docs/permissions/), [config](https://opencode.ai/docs/config/) and [models](https://opencode.ai/docs/models/) pages, and the installed server's `/doc`.

## Tasks

1. **The spike.** Install opencode, connect one provider, and write under **Measurements**:
   - the version, and whether its HTTP API is the one the docs describe;
   - a prompt with `format` and the `PassAnswer` union as its schema: whether it's accepted, and where the answer is;
   - the tools the model has under a deny-all config, and what a tool call looks like in the answer's parts;
   - how to run without the project's config, `AGENTS.md`, plugins and MCP servers, starting the server in an empty directory;
   - whether a message reports tokens and cost;
   - what `GET /provider` says with no provider connected;
   - the time to start the server, and whether two prompts can run at once on it, as three of the passes do.

   If structured output or the lockdown can't be had, stop and record why; the stage is then closed as not done, with the reason in ARCHITECTURE.md's rejected alternatives.
2. **`opencode-server.ts`.** Start `opencode serve` without a shell, wait for it to answer, hand out its base URL and password, and stop it with megareviewer. One that dies is started again on the next use.
3. **`opencode-request.ts` and `opencode-output.ts`.** The session and prompt bodies as pure functions of the input, the model and the pass; the answers parsed with Zod. The system prompt is the shared one, with the PR data where task 1 finds the provider's cache keeps it, if the answer shows cache use at all.
4. **`opencode-errors.ts`.** To `ModelError`: not installed, no provider connected, the provider's own failure passed through with its message, a `StructuredOutputError` as invalid output so the pipeline retries it once, a tool call as `unexpected`.
5. **`opencode-status.ts`.** Installed or not, its version, and the options from the connected providers' models.
6. **`opencode-analysis-model.ts`.** An `AnalysisModel` over `createPassModel`. `checkSize` uses the model's context size if the provider list gives one, else the shared 400,000 budget, with the provider's own too-long error as the backstop. Its `version` is `opencode/<provider>/<model>/pN`.
7. **The provider** in `model-access.ts` and `doctor.ts`. Its options' `via` names the provider behind it: "opencode, on your Anthropic key".
8. **The menu at length.** A reviewer may have dozens of models connected. The group shows the provider's default first and the rest behind a filter field, so the menu doesn't outgrow the window.
9. **Docs, in the same PR as the code.** ARCHITECTURE.md: the provider in *Credentials* and *Model passes*, and the unmeasured chip. README.md: setup, what unmeasured means, and Privacy: with opencode the code goes to whichever provider the chosen model is on, or nowhere for a local one.

## Not in this stage

- Connecting a provider from megareviewer, or `PUT /auth/:id`.
- Evals on opencode's models, beyond one case run to check the pipeline end to end.
- Attaching to an opencode server the reviewer already runs. megareviewer starts its own, so it knows the config it runs under.

## Tests

- **Request and output:** from fixtures recorded in the spike; synthetic ones named so.
- **Lockdown:** an answer with a tool part other than `StructuredOutput` fails the pass.
- **Server:** started once for parallel passes, restarted after it dies, stopped on shutdown; a port that never answers is a disabled provider with that reason.
- **Status:** not installed, installed with nothing connected, and with two providers connected.
- **Contract:** the adapter passes `analysis-model-contract` on a fake server.

## Definition of done

- [ ] `pnpm check` passes.
- [ ] The spike's answers are under **Measurements**.
- [ ] On delphi-code #2 with a model chosen through opencode, all five passes complete, and the usage line names the model and the provider behind it.
- [ ] A PR whose description tells the model to run a command ends in a failed pass with the lockdown's reason.
- [ ] With opencode missing, or with no provider connected, its group is one disabled row with the fix.
- [ ] ARCHITECTURE.md and README.md updated as in task 9.

## Measurements

### Task 1: the spike

opencode 2.3.0 (`~/.opencode/bin/opencode`), macOS 15, the Anthropic provider from `ANTHROPIC_API_KEY` in the environment, `claude-haiku-5-5`, 2026-11-14. Each server was `opencode serve --hostname 127.0.0.1 --port <n>` in a new empty directory, with `OPENCODE_SERVER_PASSWORD`, a config in `OPENCODE_CONFIG_CONTENT`, and `OPENCODE_DISABLE_PROJECT_CONFIG`, `OPENCODE_DISABLE_CLAUDE_CODE`, `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS`, `OPENCODE_DISABLE_AUTOUPDATE` and `OPENCODE_DISABLE_FILEWATCHER` set. Requests to the provider were read through a logging proxy set as the provider's `baseURL`.

- **It's V2, and the API the stage was planned on is gone.** The spec is at `GET /openapi.json` ("Experimental HttpApi surface"); `/doc` serves the web app. Every route is under `/api`. V1's `POST /session/:id/message`, `/provider` and `/config/providers` aren't served (405, or the web app). V1's `OutputFormatJsonSchema` is still in the binary, for reading V1 sessions, not on any route.
- **No structured output on the prompt.** `POST /api/session` takes `agent`, `model`, `permissions` and a location; `POST /api/session/:id/prompt` takes `text`, files, agents and skills, and only queues the input. `POST /api/experimental/session/:id/wait` waits for the loop to go idle, and `GET /api/session/:id/message` returns the messages. Neither route has `format`, `system` or `tools`. `POST /api/experimental/generate/text` is one stateless call with a prompt and a model only: no system prompt, schema or usage.
- **Provider-native structured output through `body` works, and is one schema per server.** A provider's `body` in the config is merged into its requests: `output_config.format` with the `PassAnswer` schema reached Anthropic as sent. An agent's `request.body` isn't sent. The config is read when the server starts, so a schema per pass would need a server per pass or a config change between calls, and every provider package names the field differently (`output_config`, `response_format`, `text.format`, Gemini's).
- **The `PassAnswer` union is too large for Anthropic's structured outputs now.** The same request straight to the API, without opencode, its tools or its thinking settings, fails on Haiku 5.5 and Sonnet 5.5 with 400 "The compiled grammar is too large, which would cause performance issues". Each pass's variant alone is accepted and answered. This hits megareviewer's own API transport too, which sends the same union (`src/adapters/model/claude/request.ts`); see **Open issues**.
- **The system prompt.** An agent defined in the config sets it (`agents.<id>.system`), and it goes first, with a cache breakpoint. opencode adds three blocks after it: the model's name and IDs; the date, working directory, platform and its temp directory ("approved for external access"); and a line about `execute` and worktrees. A global `AGENTS.md` in the config directory is added too: one planted in a directory given as `OPENCODE_CONFIG_DIR` reached the request, which also takes the user's `~/.config/opencode` and `~/.opencode` out of the config. An `AGENTS.md` in the work directory didn't, with `OPENCODE_DISABLE_PROJECT_CONFIG`.
- **The lockdown leaves one tool.** An agent whose permissions end with `{action: "*", resource: "*", effect: "deny"}` (last match wins, after opencode's defaults) is sent one tool, `skill`, whatever else is denied, `skill` by name included. With no skills found the model said it had nothing to load. Asked to run a shell command, it said it had no shell. A tool call's part in a message wasn't seen: the model never called `skill`. Skills from `~/.agents/skills` are watched; whether the config-dir switch hides them wasn't checked.
- **`steps: 1` breaks Claude 5.5.** On the last step opencode adds an assistant message, which Haiku 5.5 refuses: "This model does not support assistant message prefill".
- **Usage and cost per message.** An assistant message has `tokens` (`input`, `output`, `reasoning`, `cache.read`, `cache.write`), `cost` in USD from opencode's model catalog, `finish` and `rawFinish`. The first call wrote the system prompt to cache (970 tokens), the next read 850 of it. A failed call is an assistant message with `finish: "error"` and an `error` of `type` (`provider.invalid-request`, `provider.transport`), `message`, `status` and the provider's body, then an `idle` item with `outcome: "failed"`.
- **Models.** `GET /api/model` lists every model of the enabled providers, each with `providerID`, `name`, `variants` (effort levels), `cost` per million tokens, `limit.context` and `limit.output`, `capabilities` and `status`; `GET /api/model/default` gives one. `GET /api/provider` lists providers with `activation` (`enabled`, `auto`). opencode's own free provider (`opencode`, `https://opencode.ai/inference`) is enabled unless `OPENCODE_DISABLE_FREE_MODELS` is set.
- **Nothing connected.** Without the key and with free models off, `GET /api/provider` and `GET /api/model` are empty and the default model is `null`.
- **Start and parallel prompts.** The server listened within 0.2 s. Three sessions prompted at once all answered, in 1.9 s together against 1.5 s for one.
- **Auth.** Basic auth with the password; without it, or with a wrong one, `/api/*` answers 401.
- **Sessions go into the reviewer's opencode history.** They're stored in `~/.local/share/opencode/opencode.db`, the data directory the reviewer's stored credentials live in, and listed by `GET /api/session`; `DELETE /api/session/:id` removes one (204).
- **A provider that can't be reached** fails after about 80 seconds of retries, as `provider.transport`.

So the stage's first condition fails as planned: 2.3.0 has no structured output a prompt can ask for. What's left is a schema per provider package in the server's config, which Anthropic refuses for the union, or JSON asked for in the prompt and checked by Zod. The lockdown holds as far as tools go, with `skill` the one left.

## Open issues

- **V1 or V2.** 2.3.0 is V2, and serves only V2's routes (see **Measurements**).
- **The Anthropic API refuses the `PassAnswer` union.** Measured in the spike, outside opencode: "The compiled grammar is too large" on Haiku 5.5 and Sonnet 5.5, so the API transport, the fallback when Claude Code can't run, likely fails every pass. Not this stage's to fix; it belongs to the Claude adapter.

## Notes for later stages
