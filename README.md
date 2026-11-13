# megareviewer

Turns a GitHub or Bitbucket Cloud pull request into a guided review. Changes are ordered as a tour that follows the call graph, with each test next to the code it tests. Risky changes (dependencies, schemas, auth, CI, removed tests) stand out, and mechanical ones are collapsed with proof. Your review is posted back to the PR.

On any review, Analyze with Claude adds what the PR was asked to do next to what the code actually does, plain-language titles for the tour's steps, and the decisions the code makes for you to approve or reject.

## Run

Needs Node 22.13 or later.

```bash
npx megareviewer
```

It starts a server on `127.0.0.1` and opens the review UI in your browser. `--port <n>` picks the port, and `--no-open` skips the browser. Run it in a git checkout of the PR's repository, or pass `--checkout <dir>`, and the review also shows the code outside the PR that calls what it changes. The checkout is only read, and only when it has the PR's head commit.

```bash
npx megareviewer doctor
```

`doctor` checks every credential below and exits 1 if something required is missing.

## Credentials

Set them as environment variables. You need at least one git host.

**GitHub.** The first one found is used:

| Source | Notes |
|---|---|
| `GITHUB_TOKEN` | Fine-grained token with Pull requests: read and write, Contents: read and Metadata: read. A classic token needs `repo` (or `public_repo` for public repositories only) |
| `GH_TOKEN` | Same as `GITHUB_TOKEN` |
| `gh auth token` | Used when you're signed in with the GitHub CLI |

**Bitbucket Cloud**

| Variable | Notes |
|---|---|
| `BITBUCKET_EMAIL` | Your Atlassian account email |
| `BITBUCKET_API_TOKEN` | A scoped Atlassian API token with `read:user:bitbucket`, `read:repository:bitbucket`, `read:pullrequest:bitbucket` and `write:pullrequest:bitbucket` |
| `BITBUCKET_USERNAME` + `BITBUCKET_APP_PASSWORD` | Used instead of the two above when they aren't set: your Bitbucket username and an app password with Account: read, Repositories: read and Pull requests: write. Atlassian removed app passwords in July 2026, so they only work where Bitbucket still accepts them |
| `BITBUCKET_WORKSPACE` | Optional. The workspace whose PRs the picker lists. It scans the 50 most recently updated repositories; a pasted PR URL always works |

**Claude.** Only for Analyze with Claude, which runs your Claude Code when it's installed and signed in, so the analysis comes out of your Claude plan's usage. megareviewer never sees your Claude credentials: it runs the `claude` on your PATH, which uses its own sign-in. Without Claude Code, it uses the Anthropic API, with `ANTHROPIC_API_KEY` or a profile from `ant auth login`, billed to your account. Either way, analyses use Claude Haiku 5.5.

**Jira.** Optional: without it, ticket keys are shown but not fetched.

| Variable | Notes |
|---|---|
| `JIRA_BASE_URL` | e.g. `https://your-site.atlassian.net` |
| `JIRA_EMAIL` | Your Atlassian account email |
| `JIRA_API_TOKEN` | An Atlassian API token without scopes (scoped tokens don't work with the site URL) |

## Privacy

Until you press Analyze with Claude, your code goes nowhere but your machine and your git host. Then the PR's code also goes to Anthropic for the analysis: through your Claude Code, under your own Claude plan and its privacy settings, or to the Anthropic API under your API account's. Nothing is sent to us, and there is no telemetry. Credentials stay in the local server process and never reach the browser. Analyses and verdicts are stored in `~/.megareviewer` (`MEGAREVIEWER_HOME` to move it).

## Contributing

With pnpm installed, `pnpm install`, then `pnpm check` (types, lint, dependency rules, tests), `pnpm build` and `pnpm e2e` (end-to-end tests against the build) are what CI runs. `pnpm local` builds the package and starts it, as `npx megareviewer` would; arguments go after it, e.g. `pnpm local --checkout ~/code/repo`.

- [MISSION.md](MISSION.md): why this exists
- [DESIGN.md](DESIGN.md): how review should work
- [ARCHITECTURE.md](ARCHITECTURE.md): how it's built
- [ENGINEERING.md](ENGINEERING.md): how we write code
- [docs/plan](docs/plan/README.md): the implementation plan
- [evals](evals/README.md): measuring the model passes
