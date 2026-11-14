# Contributing

## Development setup

Use a Python 3.12+ build that supports SQLite loadable extensions, such as a uv-managed one:

```sh
uv venv --managed-python .venv
uv pip install -r requirements-lock.txt
uv pip install --no-deps --no-build-isolation -e .
uv pip install --group dev
.venv/bin/delphi-code setup
```

## Code conventions

The aim is code a newcomer can read top to bottom without a guide.

**Layers.** Each folder is one layer, and dependencies point downward; `tests/test_layers.py` enforces the direction:

| Layer | Location | Knows about |
|---|---|---|
| Front end: CLI | `cli/` | `main.py` (argparse; picks the port implementations, calls one controller, writes its data as JSON or its views as text), `controllers/` (one function per command), `terminal/` (everything drawn on or asked in the terminal) |
| Front end: MCP | `mcp_server/` | `tools.py` defines one MCP tool per command except `connect` and `disconnect`, calls services directly and returns their data; `stdio_protocol.py` is JSON-RPC over stdio, no SDK |
| Front end: HTTP | `http_api/` | `app.py` (`create_app(delphi_code, settings)`), one router per resource in `routes/` (`hosting_services.py` lets a browser drive the repository picker itself: list hosting services, owners and repositories, then post the picked changes), `response_models.py` (pydantic mirrors of each result's `to_json()`, so OpenAPI describes them), `failures.py` (`FailureKind` to HTTP status), `security.py` (token, and same-origin for writes), `progress_stream.py` (writes run one at a time in a worker thread and stream `Progress` events as NDJSON, ending with `done` or `failed`; a failure before the first event is an ordinary error response); `server.py` (`LoopbackServer` binds 127.0.0.1 itself and runs uvicorn on that socket); `web_ui_files.py` serves the built web UI from `delphi_code/web/` without a token, answers client routes with its `index.html`, and adds the page's security headers; `web_ui_launch.py` (`serve`, which `delphi-code ui` runs: reuses a live server named in `web-ui-server.json` in the data directory, or starts one with a new token, records it there readable only by the owner, and removes the record on exit); FastAPI, pydantic and uvicorn are imported only here |
| Front end: web UI | `web/` (source), built into `delphi_code/web/` | a React and TypeScript single-page app served by `http_api`; it talks to the core only through `/api`. `src/api/` holds the client generated from the API's OpenAPI schema (`schema.d.ts`), the token handoff, failures, and `runStreamedWrite` for NDJSON writes. Screens start writes through `useWriteActivity().startWrite`, which runs one at a time like the server, shows its progress in the shared `ActivityPanel`, and refreshes the project and search queries when it ends. Routes live in `src/routes/`. `vite-plugins/thirdPartyLicensesFile.ts` writes `third-party-licenses.txt` into each build with the license texts of every bundled package |
| Services | `services/` | what a command does; each returns one typed result from `domain/`, the same for every front end. `application.py` (`DelphiCode`) is the one entrance: it holds the store, registry and model location and has one method per use case. The modules behind it: `indexing`, `searching`, `tracking`, `remote_repositories`, `project_catalog`, `model_installation`, `diagnostics`, `agent_connections`, plus the `Progress` port |
| Infrastructure | `infrastructure/` | disk, git, network and libraries: `store`, `registry`, `model`, `vector_index`, `files`, `sources`, `hosts`, `project_identity`, `model_assets`, `paths`, `offline`, `agent_configs` (each agent's MCP config file or CLI) |
| Domain | `domain/` | pure rules with no I/O: `errors`, `keys`, `manifest`, `selection`, `tracking_changes`, `agent_connection`, the results services return (`search_hits`, `indexing_outcomes`, `tracking_report`, `project_listing`, `index_state`, `diagnostics`), and `hosting_services` (`HostingService`, `Owner`, `Repository`: what front ends see of Bitbucket and GitHub, while `infrastructure/hosts.py` keeps the API clients) |

Front ends reach the core only through `DelphiCode` (built once per process with `DelphiCode.from_environment()`), `services.progress`, and `domain` types; the other imports are `infrastructure.log_file` to set up logging and `infrastructure.web_ui_server_record` for the running web UI server's record. They never import each other, except that `cli/main.py` starts the other front ends' servers through their `serve`, imported inside the command that runs them so the CLI never loads their libraries otherwise. Nothing below a front end imports it, and no module outside `cli/` sees an `argparse.Namespace`. `infrastructure/hosts.py` and `infrastructure/model_download.py` also run as standalone scripts in a separate process, so they never import package modules unconditionally (`hosts.py` imports `domain.errors` only under `if __package__`).

**Terminal UI.** Only `cli/terminal/` writes to the terminal. Controllers call one `DelphiCode` method and build views, importing only `terminal/views/`, `terminal/text_layout.py` and `TerminalProgress` from it; `TerminalProgress.showed_outcome_lines` tells them whether progress already printed each project's outcome, which no other front end needs to know. They depend on two ports instead of the terminal. `Progress` (`services/progress.py`) receives events and does nothing by default; `cli/terminal/progress.py` draws them. `Prompts` (`cli/controllers/repository_picking.py`) asks single questions; `cli/terminal/prompts.py` answers them in the terminal. A controller decides what is asked and when, gathers every decision first, and then calls one `DelphiCode` method such as `apply_picked_changes`, so services never ask. Each controller returns a `ControllerResponse` with the data for JSON output and the views for text output. `cli/terminal/` knows only `domain` and `services.progress` outside itself, so views read typed results.

**Interfaces.**
- Hide representations behind objects. Callers ask `manifest.ready` or `index.search(...)`; they never reach into JSON dicts or SQL.
- Pass domain types (`LocalModel`, `FileSelection`, `Checkout`, `Manifest`), not tuples or loose dicts. Results are frozen dataclasses whose `to_json()` is the one JSON shape every front end returns; dicts appear only there.
- A partly failed sync is a result, not an exception: `SyncReport` and `TrackingReport` hold each project's outcome, and each front end decides what a failure means (`failure_if_any_failed()` gives the CLI and MCP their `sync_failed` error).
- Anything a module does not export starts with `_`. Public functions and methods carry type hints.
- Constructors stay cheap; expensive work (loading the encoder, hashing) is lazy or explicit (`LocalModel.inspect`).

**Names over comments.** Make names carry the meaning and default to no comments or docstrings. Keep a comment only for a non-obvious *why* that no name can express. Replace magic values with named constants.

**Errors.** Raise `Failure(code, message, FailureKind.X)` from `errors.py`. `code` is the stable machine-readable identifier; `FailureKind` says what went wrong, not how a front end reports it: pick the kind that describes the cause (a project that does not exist is `NOT_FOUND`, a locked index is `BUSY`), and let each front end map it, such as `cli/terminal/output.py` to the exit codes in the README. The message tells the user how to recover.

**Tests.** Test behaviour through public seams: the CLI entry points, `LocalModel.inspect` (replaced by `tests/fakes.FakeModel`), and `services.indexing.index_checkout`. Do not patch private helpers. `tests/test_front_end_contract.py` runs the same commands through every front end and requires the same data and failure codes; add a row there for each new command. HTTP tests use FastAPI's in-process `TestClient`; `tests/test_http_server.py` also runs the real server over TCP. The network guard covers the whole process while it indexes or searches, so a test must not open a new connection to a server in its own process while a request is still running.

**Style.** Ruff formats and lints (120 columns) and pyright type-checks the package. Run them before committing:

```sh
bash scripts/lint.sh
```

## Tests

Run the regular suite from the checkout root:

```sh
bash scripts/test.sh
```

It covers setup logic, project resolution, storage paths, model defaults, and cross-project ranking with real SQLite and mocked embeddings. It needs installed dependencies, but no prepared model or OS network sandbox, and makes no external requests; indexing and search still run under the Python network guard in `infrastructure/offline.py`. `.venv/bin/python -m unittest discover -s tests -v` runs the same suite.

Run the offline integration suite separately, on macOS with a prepared model:

```sh
export DELPHI_CODE_TEST_MODEL="$HOME/Library/Application Support/delphi-code/models/all-MiniLM-L6-v2"
bash scripts/test_offline.sh
```

Set `DELPHI_CODE_TEST_MODEL` to the actual model location; a model prepared inside the checkout can use `"$PWD/.models/all-MiniLM-L6-v2"`. Both scripts accept `DELPHI_CODE_PYTHON` to select a different Python executable.

The `tests/offline` suite launches real CLI subprocesses under OS network denial, uses an empty Hugging Face cache, and records Python DNS/connect attempts before runtime imports. It covers offline model import and reuse, missing models, doctor, actual retrieval, same-content reuse, preserved-mtime edits, deletion, ignore negation, filters, line numbers, empty results, and JSON output and exit codes. A separate socket probe verifies that the OS blocks networking. The directory is intentionally outside regular unittest discovery, so run both scripts for the full check. Neither suite tests live model downloads; CI does (see below).

## Web UI

The web UI lives in `web/` and needs Node 24 (`web/.nvmrc`) and pnpm through Corepack (`corepack pnpm …`). `pnpm build` writes the page into `delphi_code/web/`, which is not committed: build it before installing from a checkout, or `delphi-code ui` shows how to.

```sh
cd web
corepack pnpm install
corepack pnpm check && corepack pnpm typecheck && corepack pnpm test
corepack pnpm build
```

For development, run `delphi-code ui --no-browser`, then `DELPHI_CODE_API_URL=http://127.0.0.1:PORT corepack pnpm dev` and open Vite's address with the printed `#token=…`. Vite proxies `/api` to the server and presents the server's own origin, so writes pass the same-origin check. After changing a route or response model, run `corepack pnpm api:generate` and commit `openapi.json` and `src/api/schema.d.ts`; a Python test fails while `openapi.json` is stale, and CI fails while `schema.d.ts` or `src/routeTree.gen.ts` differ from what the tools generate. Streamed writes declare their final result with `streamed_responses(ResultModel)` so the client knows it.

Browser tests run the built page against the real server: `corepack pnpm exec playwright install chromium` once, then `corepack pnpm build && corepack pnpm e2e`. `tests/e2e_server.py` serves a temporary data directory with one indexed project and the fake model. CI runs them against the installed wheel.

## Claude Code plugin

The plugin lives in `plugin/` in two formats that share `skills/`: Claude Code's (`.claude-plugin/plugin.json`, `.mcp.json`, listed by `.claude-plugin/marketplace.json` at the repository root) and the open [Agent Plugins](https://agent-plugins.org) 1.0.0 format that Codex and Cursor read (`plugin.json`, `mcp.json`, listed for Codex by `.agents/plugins/marketplace.json`). Keep the descriptions and server command in sync. `delphi_code/infrastructure/SKILL.md` is a copy of the plugin's skill that `connect` installs for agents without a plugin; a test fails when the two differ. Neither has a `version`, so users get each commit. Check Claude Code's with `claude plugin validate .` and try it with `claude --plugin-dir ./plugin`; check the portable files against the schemas in the [spec repository](https://github.com/agentplugins/agent-plugins-spec).

## Third-party notices

For a release that bundles dependencies, run `scripts/collect_notices.py` in the release environment and `scripts/prepare_notices.py` during online preparation. Both collect notices under `build/third_party/`; review them and include them with that release. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Releasing

The `Publish` GitHub Actions workflow builds and validates distributions on every push to `main`, then installs the wheel on macOS, runs an online `delphi-code setup`, both test suites, and a smoke test outside the checkout. A second macOS job installs the wheel through `scripts/install.sh` on a runner with an empty home directory and no uv, the way a new user would, then runs `--version`, `index`, `search`, and `doctor`. A release is published only when every check passes.

To release:

1. Bump `version` in `pyproject.toml` and push to `main`.
2. Once the workflow passes, push a matching tag, for example `git tag v0.1.1 && git push origin v0.1.1`. The tag must match the package version.

The tag run repeats the checks and publishes to PyPI through a Trusted Publisher (project `delphi-code`, owner `markdorof`, repository `delphi-code`, workflow `publish.yml`, environment `pypi`). Publishing uses GitHub OIDC; no stored PyPI token is needed. PyPI never accepts the same version twice.

After publishing, the tag run creates a GitHub Release with the distributions and `install.sh` attached and notes listing the commit subjects since the previous tag. Commit subjects are the changelog, so write them for users. Mention index format changes that need a rebuild in the release notes by editing the release afterwards.

`pyproject.toml` pins direct dependencies and bounds the risky indirect ones (torch, transformers, huggingface-hub, tokenizers), because `uv tool install` ignores `uv.lock`. Move those bounds when a new version has passed CI.
