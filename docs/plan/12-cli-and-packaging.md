# Stage 12: CLI, composition root and packaging

**Status:** Done (pushed to main without a PR; CI green on 03810d5; `dist/web/` and its notices checked in stage 17)
**Depends on:** 04, 05, 06, 07, 08, 09, 11
**Unblocks:** 17
**Owns:** `src/cli/`, `scripts/build.ts`, `scripts/check-package.ts`, `package.json` (`bin`, `files`, `build` script)

## Goal

`npx megareviewer` works: it resolves credentials, wires every adapter into the use cases, starts the server, and opens the browser. The build produces a single-file, zero-dependency npm package.

## Read first

- [ARCHITECTURE.md](../../ARCHITECTURE.md) "Shape", "Credentials", "Local server security", "Why TypeScript everywhere"
- [ENGINEERING.md](../../ENGINEERING.md) §3 (`cli` is the only place that knows concrete adapters)
- The constructors from stages 04–09 and 11, and `createUseCases` from stage 10

## Scope

**In:** argument parsing, configuration and credential resolution, wiring, startup and shutdown, `doctor`, logger, fake mode for development and end-to-end tests, the production build and package checks.
**Out:** publishing to npm (stage 17).

## Tasks

### 1. Configuration: `src/cli/config.ts`

The only module that reads `process.env` or runs other programs. Returns a typed config or a list of problems.

| Setting | Source |
|---|---|
| GitHub token | `GITHUB_TOKEN`, else `GH_TOKEN`, else `gh auth token` (run with `execFile`, 5-second timeout; missing `gh` or non-zero exit means "not configured") |
| Bitbucket | `BITBUCKET_EMAIL` + `BITBUCKET_API_TOKEN` (both or neither; one alone is a problem), `BITBUCKET_WORKSPACE` optional |
| Jira | `JIRA_BASE_URL` + `JIRA_EMAIL` + `JIRA_API_TOKEN` (all or none) |
| Anthropic | Not read here. The SDK resolves `ANTHROPIC_API_KEY` or an `ant auth login` profile itself. `doctor` checks it. |
| Home directory | `MEGAREVIEWER_HOME`, default `~/.megareviewer` |
| Log level | `MEGAREVIEWER_LOG` (`debug`, `info`, `warn`, `error`; default `warn`) |

At least one git host must be configured; otherwise exit 1 with instructions for both hosts.

### 2. Arguments: `src/cli/args.ts`

With `node:util` `parseArgs`, no dependency:

```
megareviewer [--port <n>] [--no-open]
megareviewer doctor
megareviewer --version
megareviewer --help
```

Exit codes: 0 success, 1 configuration problem, 2 usage error.

### 3. Logger: `src/cli/logger.ts`

A `Logger` that writes one line per entry to stderr: time, level, message, fields as `key=value`. Redacts any field whose name contains `token`, `secret`, `password` or `authorization`.

### 4. Wiring: `src/cli/compose.ts`

```ts
compose(config, options: { grammarsDir: string; staticDir: string | null; version: string }): Promise<{ app: Hono; useCases; close(): Promise<void> }>
```

1. Create `MEGAREVIEWER_HOME` with mode `0700` if missing.
2. `openSqliteAnalysisStore({ path: <home>/db.sqlite })`.
3. Hosts: `createGitHubHost` and/or `createBitbucketHost` for configured ones.
4. Tickets: `createJiraTicketSource` or `createUnconfiguredTicketSource`.
5. `createClaudeAnalysisModel`. `modelConfigured` is false if the SDK can't find credentials at construction; analyses then fail with a clear `model-error` message.
6. `createTreeSitterCodeParser({ grammarsDir })`.
7. Clock, events, `createUseCases`, `recoverInterruptedAnalyses()`.
8. `createHttpApp` with a fresh session token: 32 random bytes, base64url.

### 5. Startup: `src/cli/main.ts`

1. Parse args and config.
2. Suppress only Node's `ExperimentalWarning` about SQLite: replace the default `warning` listener with one that drops that single warning and prints the rest.
3. Compose, then `startHttpServer` on `--port` or `0`. Set `allowedHosts` to `127.0.0.1:<port>` and `localhost:<port>` once the port is known (create the app after the port is chosen, or make allowed hosts settable).
4. Print the configured hosts, Jira status, and the URL `http://127.0.0.1:<port>/?token=<token>`.
5. Open the browser unless `--no-open`: `open` on macOS, `xdg-open` on Linux, `cmd /c start ""` on Windows, spawned detached. Failure only logs a warning; the URL is printed anyway.
6. On `SIGINT`/`SIGTERM`: stop accepting requests, close the server and the database, exit 0.

### 6. `doctor`: `src/cli/doctor.ts`

Prints one line per check with ✓ or ✗ and a fix hint:

- Node version ≥ 24.
- Each git host: configured from which source; `currentUser()` succeeds.
- Jira: configured; one `getTickets` call for a key that doesn't exist (expects `missing`, proves auth works).
- Anthropic: SDK finds credentials; a `models.retrieve("claude-opus-5-5")` call succeeds (free).
- Home directory writable, database opens.

### 7. Fake mode for development and end-to-end tests: `src/cli/dev/`

`node src/cli/dev/fake-main.ts [--port <n>] [--token <t>] [--static <dir>]` composes the app with stage 02's fakes, seeded with every fixture, an in-memory store, and the real tree-sitter parser. It prints the URL and token like the real CLI. `--token` lets end-to-end tests fix the token; `--static` serves a built UI. Never part of the bundle. Add `pnpm dev:fake`.

Seed one extra fixture PR whose model intent pass fails on the first attempt, so the failed-analysis flow can be exercised.

Fake mode also mounts control routes under `/__fake/` (token-protected like `/api`), for stage 17's end-to-end tests:

| Route | Effect |
|---|---|
| `GET /__fake/publications` | What `FakeGitHost` received |
| `POST /__fake/fail-publish-comment` `{ n }` | The next publish fails on its Nth comment |
| `POST /__fake/set-head` `{ url, headSha }` | Changes a PR's head SHA (makes analyses stale) |

These routes exist only in fake mode; a test asserts the real composition doesn't mount them.

### 8. Build: `scripts/build.ts`

`pnpm build` runs it:

1. `vite build` for the UI → `dist/web/`.
2. esbuild: `src/cli/main.ts` → `dist/cli.js`. `bundle`, `platform: "node"`, `target: "node24"`, `format: "esm"`, not minified (users can read what they run), `banner` with `#!/usr/bin/env node` plus a `createRequire` shim for CommonJS dependencies inside the ESM bundle.
3. Copy the tree-sitter runtime and grammar `.wasm` files to `dist/grammars/`.
4. Write `dist/THIRD_PARTY_LICENSES.txt` with the license text of every bundled package (bundling MIT and Apache code requires shipping their notices).
5. At runtime, `main.ts` finds `web/` and `grammars/` relative to `import.meta.url`.

`package.json`: `"bin": { "megareviewer": "dist/cli.js" }`, `"files": ["dist"]`. Stays `"private": true` until stage 17.

### 9. Package checks: `scripts/check-package.ts`

Run in CI after `pnpm build`:

- `pnpm pack`, then list the tarball: only `dist/**`, `package.json`, license and readme files.
- `package.json` in the tarball has no `dependencies`, and no `scripts` that run on install.
- Unpack into a temp directory and run `node dist/cli.js --version` there, with no `node_modules` around.
- Report the tarball size; fail above 50 MB (grammars are the bulk).

## Tests

- Config: every source and precedence, partial Bitbucket/Jira config as a problem, `gh` missing, `gh` failing.
- Args: each command and flag, bad input exits 2.
- Logger redaction.
- Wiring smoke test: compose with fakes on port 0, call `/api/status` with the token, get 200; without the token, 401.
- Shutdown closes the database.

## Definition of done

- [ ] `pnpm build` produces `dist/cli.js`, `dist/web/`, `dist/grammars/` and the license file. Everything but `dist/web/`: see Open issues.
- [x] `scripts/check-package.ts` passes in CI (green on 03810d5; 1.4 MB tarball).
- [x] Manually: `node dist/cli.js` with a real GitHub token opens the picker; `doctor` reports accurately. With the `gh` token, `/api/status` shows the user and `/api/pull-requests` lists their PRs; there's no picker to open yet. `doctor` was right about GitHub, the missing Anthropic credentials, and a stray `BITBUCKET_WORKSPACE`.
- [x] `pnpm dev:fake` serves a working app against fixtures. The API only, until there's a UI to pass with `--static`.

## Open issues

- **`standardwebhooks`** (pulled in by `@anthropic-ai/sdk`) ships no license file. Its `package.json` says MIT, its repo's `LICENSE` is Apache-2.0. `build.ts` lists it as a reviewed exception with what its `package.json` says; any other package without a license file fails the build.
- **Anthropic not checked live:** no credentials on the machine used, so `doctor`'s `models.retrieve` call and an analysis through the bundle are unverified.

## Notes for later stages

Where the code differs from or adds to this doc.

- **Shape.** `compose(config, { grammarsDir, staticDir, version, logger })` resolves to `Result<Composition, string>`: a missing home directory or a database that won't open (one from a newer version says to upgrade) is a message, not a stack trace. `Composition` is `{ useCases, sessionToken, modelConfigured, app(port), close() }`. The app takes the port because its Host check needs it, and with `--port 0` the port is known only after listening: `serve(appFor, port)` in `serve.ts` listens first, then makes the app. `assemble(deps, options)` is the part after the adapters, shared with fake mode.
- **Config** returns `{ config, problems }`, not one or the other, so `doctor` still checks the rest; the server starts only without problems. Blank variables count as unset. `BITBUCKET_WORKSPACE` without credentials is a problem. `BITBUCKET_USERNAME` + `BITBUCKET_APP_PASSWORD` are read only when neither API-token variable is set (added after the release; see ARCHITECTURE.md "Credentials"). A relative `MEGAREVIEWER_HOME` resolves against the working directory. The config is the only reader of configuration; the SDK reads `ANTHROPIC_*` itself, and `open-browser.ts` runs the opener.
- **No Anthropic credentials.** `anthropicConfigured` checks the client's API key or auth token, else an `ant auth login` profile via the SDK's `loadConfig` (`@anthropic-ai/sdk/core/credentials`). Without them the model is `unconfiguredModel`, which fails every pass as `unauthorized` with the fix, so the analysis fails as a `model-error` instead of the SDK throwing.
- **`doctor`** marks unconfigured optional services `–`, besides ✓ and ✗, and exits 1 when any check fails. Jira is probed with `MEGAREVIEWER-0`. The model ID is repeated in `doctor.ts`, since the Claude adapter doesn't export it.
- **Startup and shutdown.** A port in use exits 1. Without a built UI, startup says only the API is served. A second Ctrl+C exits at once with 1. Node 24.21 no longer warns that SQLite is experimental; the filter in `warnings.ts` is for earlier 24.x releases.
- **Fake mode.** The extra PR is small-feature at `https://github.com/acme/shop/pull/104`; its first intent pass fails as `overloaded`, and a retry completes. `GET /__fake/publications` answers `{ attempts: PublishAttempt[] }`, GitHub's first. `POST /__fake/fail-publish-comment { n }` arms both fake hosts, and counts posts as `FakeGitHost.failPublishAtPost` does: the summary is post 1. The control routes do their own Host and token checks, because the HTTP adapter doesn't export its middleware. Fake mode uses the system clock and reports version `<version>-fake`.
- **Build.** Notices come from esbuild's metafile, so every package with code in the bundle is listed. Grammar notices come from `PROVENANCE.md` and the license texts it links in `grammars/licenses/`; a `.wasm` without a row that links one fails the build. `dist/cli.js` is about 2.5 MB and executable. `check-package.ts` also requires `dist/cli.js`, rejects optional, peer and bundled dependencies and a `prepare` script, and runs `--version` with only `PATH` set. CI runs it after `pnpm build` (stage 01's workflow, one added step).
- **ARCHITECTURE.md's** credentials table now lists `GH_TOKEN` between `GITHUB_TOKEN` and `gh auth token`, as this doc does.
