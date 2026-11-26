# megareviewer

Turns a GitHub or Bitbucket Cloud pull request into a guided review. Changes are ordered as a tour that follows the call graph, with each test next to the code it tests. Mechanical changes are collapsed with proof. Your review is posted back to the PR.

On any review, the Request AI review button adds what the PR was asked to do next to what the code actually does, a tour of the change in a few steps, and its findings on the code: what looks wrong, as a draft comment under its line you can add to your review as it is. Saying nothing means it's fine. You pick the verdict when you publish.

An AI review follows your preferences, kept on your machine: rules you write on the Preferences page, “Look for” or “Don't flag”, for every repository or for one, and a repository's guideline files such as `REVIEW.md` that you switch on, with the files they link. On request, megareviewer also proposes rules for a repository from the points you dismissed and raised there and your own review comments on its host; none is used until you accept it. A point says which preference shaped it, and one a “Don't flag” rule covers is folded to a line, not hidden.

## Run

Needs Node 22.13 or later.

```bash
npx megareviewer
```

It starts a server on `127.0.0.1` and opens the review UI in your browser. `--port <n>` picks the port, and `--no-open` skips the browser. The review also shows the code outside the PR that calls what it changes, read from a clone on your machine that has the PR's head commit. megareviewer looks in the folder it's started in, or the one given with `--checkout <dir>`, then in the clones it read before, then through your home folder. `--no-search` turns the last off. Clones are only read, never changed. When none has the commit, megareviewer downloads that one commit with your GitHub or Bitbucket credentials into `~/.megareviewer/repos`, and the callers appear on the open review when it's done. It needs git 2.32 or newer, and `--no-download` turns it off.

```bash
npx megareviewer doctor
```

`doctor` checks every credential below and exits 1 if something required is missing.

## Install

To have `megareviewer` as a command instead of `npx megareviewer`:

```bash
npm install -g megareviewer
```

Running it again updates it.

**With the script.** It checks your Node first, and installs into `~/.local` when npm's global folder needs root:

```bash
curl -fsSL https://raw.githubusercontent.com/markdorofeev/megareviewer/main/install.sh | sh
```

`MEGAREVIEWER_VERSION=0.2.9` before `sh` pins a version.

**Without npm.** Where npm is blocked or holds new versions back, install the same package from its GitHub release:

```bash
curl -fsSL https://raw.githubusercontent.com/markdorofeev/megareviewer/main/install.sh | MEGAREVIEWER_SOURCE=github sh
```

It goes into `~/.local/share/megareviewer`, linked as `~/.local/bin/megareviewer`, and running it again updates it. With the GitHub CLI signed in, the script checks that the file was built from this repository by its release workflow, and installs nothing if not. Releases from 0.2.10 on have the package.

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
| `BITBUCKET_API_TOKEN` | A scoped Atlassian API token with `read:repository:bitbucket`, `read:pullrequest:bitbucket` and `write:pullrequest:bitbucket` |
| `BITBUCKET_USERNAME` + `BITBUCKET_APP_PASSWORD` | Used instead of the two above when they aren't set: your Bitbucket username and an app password with Account: read, Repositories: read and Pull requests: write. Atlassian removed app passwords in July 2026, so they only work where Bitbucket still accepts them |
| `BITBUCKET_WORKSPACE` | Optional. The workspace whose PRs the picker lists, and where megareviewer asks Bitbucket who you are, so one with a repository you were given access to. It scans the 50 most recently updated repositories; a pasted PR URL always works. Without it, Connections shows an error unless the token also has `read:user:bitbucket` |

**The model.** Only for the Request AI review button, whose menu lists every model megareviewer offers, on each command or account that can run it; the ones your machine can't run are disabled, with the fix. Without a choice it runs Claude Sonnet 5.5 on the first of these that can:

- **Claude Code,** when it's installed and signed in: the analysis comes out of your Claude plan's usage. megareviewer runs the `claude` on your PATH, which uses its own sign-in, and never sees your Claude credentials.
- **The Anthropic API,** with `ANTHROPIC_API_KEY` or a profile from `ant auth login`, billed to your account.
- **Codex,** when it's installed and signed in (`codex login`): OpenAI's GPT-6 Luna and GPT-6 Sol, on your ChatGPT plan's usage, or billed to your OpenAI account if Codex is signed in with an API key. megareviewer runs your Codex, the `codex` on your PATH, and never reads its credentials. Each pass runs in Codex's read-only sandbox, without your Codex config, and is stopped if the model uses a tool.
- **opencode,** 2.3.0 or later, when it's installed and has a provider connected (`opencode auth login`, an API key in your environment, or a provider in your opencode config, local ones included): every model those providers offer, billed by each provider at its own prices, or free on a local one. megareviewer starts its own `opencode serve` on 127.0.0.1 and never reads opencode's credentials. It reads your opencode config, since that's where your providers are, but not the project's, and leaves out opencode's own free models. Each pass runs as an agent that's denied every tool, and its answer is discarded if the model used one anyway. These models are marked *unmeasured*: megareviewer's evals haven't run on them, so how often their findings are wrong isn't known, and small or local models may fail a pass more often.

**Jira.** Optional: without it, ticket keys are shown but not fetched.

| Variable | Notes |
|---|---|
| `JIRA_BASE_URL` | e.g. `https://your-site.atlassian.net` |
| `JIRA_EMAIL` | Your Atlassian account email |
| `JIRA_API_TOKEN` | An Atlassian API token without scopes (scoped tokens don't work with the site URL) |

## Privacy

Until you press Request AI review, your code goes nowhere but your machine and your git host. Then the PR's code also goes to the model's maker for the analysis: to Anthropic through your Claude Code, under your own Claude plan and its privacy settings, or through the Anthropic API under your API account's; or, with Codex, to OpenAI under your own ChatGPT plan or OpenAI account and its settings; or, with opencode, to whichever provider the chosen model is on, under your account there, or nowhere off your machine for a local model. Your preferences go with it, and the guideline files you switched on with the files they link: the ones they import always, and the others when the model opens them. Suggesting preferences sends the same maker what it reads instead of code: the points you dismissed and raised and the comments you posted, or your past comments on one repository. Nothing is sent to us, and there is no telemetry. Credentials stay in the local server process and never reach the browser. Analyses, your preferences and what you did with each point are stored in `~/.megareviewer` (`MEGAREVIEWER_HOME` to move it).

## Contributing

With pnpm installed, `pnpm install`, then `pnpm check` (types, lint, dependency rules, tests), `pnpm build` and `pnpm e2e` (end-to-end tests against the build) are what CI runs. `pnpm local` builds the package and starts it, as `npx megareviewer` would; arguments go after it, e.g. `pnpm local --checkout ~/code/repo`.

- [MISSION.md](MISSION.md): why this exists
- [DESIGN.md](DESIGN.md): how review should work
- [ARCHITECTURE.md](ARCHITECTURE.md): how it's built
- [ENGINEERING.md](ENGINEERING.md): how we write code
- [docs/plan](docs/plan/README.md): the implementation plan
- [evals](evals/README.md): measuring the model passes
