# Stage 66: megareviewer's own copy of the repository

**Status:** In progress (branch claude/full-repo-checkout-feasibility-c87b42)
**Depends on:** 65
**Owns:** a `RepositoryCopies` port with its fake and contract suite, the download in `src/adapters/git/`, the copies under megareviewer's home folder, callers added to a complete analysis in `src/application/use-cases/`, `Analysis.checkout`'s new states in `src/domain/review/analysis.ts` and `contracts/`, the `--no-download` flag, the startup summary and `doctor` in `src/cli/`, the checkout note and the callers' arrival in `web/src/pages/review/`, and "Local checkout" in ARCHITECTURE.md and DESIGN.md

## Goal

After stage 65, a reviewer with no clone of the PR's repository on their machine, or one that doesn't have the PR's head commit, still sees no code outside the PR.

This stage has megareviewer download that one commit into a copy of its own and read the callers from it:

- The review opens right away, without the callers. They arrive when the download ends.
- The copy is megareviewer's, under its home folder. The reviewer's clones are never touched, even when one of them is only missing the commit.
- When the download can't happen, the review stays as it is, and the note says why and what would fix it.

## Why, measured

oracle/graal at PR 15134's head, from GitHub at about 12 MB/s, 2026-11-25:

| What | Time | Size |
|---|---|---|
| One commit, 21,587 files | 11.9 s | 58 MB on disk |
| The same without files over 1 MB | 10.7 s | 52 MB |
| A second commit into the same copy, which has no name for the first | 14.6 s | everything again; 115 MB |
| A later commit, once each commit in the copy has a name | 1.5 to 2.2 s | 0.4 MB downloaded |
| `git gc` on a copy grown to 173 MB | 3.1 s | 58 MB for four commits |
| The whole history, by GitHub's figure | not downloaded | 532 MB |

Both hosts advertise fetching a commit by its SHA, shallow fetches and partial clones. GitHub has `refs/pull/N/head`; Bitbucket Cloud has no refs for pull requests.

## First, a check that can stop the stage

Before any code, with real accounts, and written into **Notes for later stages**:

1. **GitHub:** a private repository's commit downloads with the token megareviewer already has, from each of its three sources.
2. **GitHub, a PR from a fork:** the head commit downloads from the base repository by its SHA.
3. **Bitbucket:** a commit downloads over HTTPS with the scoped API token, and with an app password. Atlassian's docs name the user to send with an API token; megareviewer's API calls use the email.
4. **Bitbucket, a PR from a fork:** whether the head commit downloads from the destination repository. If not, the download needs the fork's name, which `PullRequest` doesn't record.

What doesn't work ships as "not downloaded", with the reason on the page, and an **Open issue**. If neither host works, stop and ask the user.

## Read first

- [ARCHITECTURE.md](../../ARCHITECTURE.md) "Local checkout", "Credentials", "Analysis pipeline", "Guardrails" (its landing is the pattern for results that arrive after a review is complete) and "Local server security"
- [Stage 65](65-clone-on-this-machine.md) and its notes, [stage 30](30-unchanged-callers.md)'s notes
- `src/adapters/git/`, `src/application/use-cases/analyses.ts` (`startFor`, `recomputeCode`), `run-pipeline.ts`, `pipeline-version.ts`, `following` in `src/domain/review/analysis.ts`

## Contract change

A separate commit, with a line in stage 02's **Change log**. The shapes are a proposal; record what differs.

- **`RepositoryCopies`:** `download(repo, sha)` answers the copy as a `LocalCheckout` that has the commit, or why not: no git, no credentials, refused, timed out, turned off. `forget(olderThan)` removes copies not read since.
- **`Analysis.checkout`** gains `downloading` and `download-failed`, and the analysis a `checkoutError`, the reason as text, null otherwise.
- **`following`** is also true while `checkout` is `downloading`, so the events stream until the callers are in.

## Tasks

### 1. The download

In `src/adapters/git/`, beside the reading:

- A copy is a bare repository at `<megareviewer's home>/repos/<host>/<owner>/<repo>.git`. With no working tree, git runs no hooks, filters, submodules or LFS.
- `git fetch --depth 1 --no-tags <https URL> <sha>`, then a ref for the commit, `refs/megareviewer/<sha>`. The ref is what makes the next download small: without one, git tells the host it has nothing.
- Only the head commit. Nothing reads the base from a checkout.
- git is run without a shell and without the reviewer's or the system's git config, with HTTPS as the only protocol, no credential helper, no prompt and no redirects followed.
- The credentials are the ones megareviewer already holds, passed in the environment as git config for that host's URL only. Never in the URL, the arguments or the copy's config. A test reads every call's arguments and the copy's config for the token.
- One download per repository at a time; a second request for it joins the first. It's cancelled when megareviewer stops, and fails after 10 minutes.
- `git gc` after a download when the copy has more than a few packs.
- At startup, copies not read for 30 days are removed, as old rows of `file_contents` are.

### 2. Callers added to a complete analysis

Today whether a checkout was read is decided before the analysis starts and is part of its key (`20+checkout`). A PR opened again after the commit arrived becomes a new analysis, and the reviewer's drafts stay on the old one. A download that ends minutes later can't work that way.

- **The key stops saying whether a checkout was read.** New analyses are keyed by the plain pipeline version. Opening a PR looks for an existing analysis under both forms, so analyses stored as `20+checkout` are still found. `PIPELINE_VERSION` isn't bumped: a bump drops every cached AI run.
- **Callers are added in place.** When the code's stages end without a checkout, and whenever a complete analysis without callers is opened: look for a checkout as stage 65 does; with none, start a download when it's on. Then compute the code's fields again with the checkout, as `recomputeCode` does, and write only `unchangedCallers`, `checkout`, `checkoutDir` and the checkout's warnings. A test holds that nothing else differs.
- **This covers a found clone too:** a reviewer who runs `git fetch` in their clone and opens the PR again gets the callers on the same analysis.
- **A model run comes first.** Callers are written only while no model run is in flight for the analysis; a download that ends during one waits for it. A run started during a download doesn't wait and reads the PR without the callers. The checkout's warnings also go into `beforeModel`, so Remove AI review keeps them.
- **A stop during a download** leaves `downloading`. The next start sets it back, and opening the PR starts again.

### 3. The page

- **The note** in the Details dialog: "Downloading acme/shop to find the code that calls what this PR changes"; then nothing, once they're in; or why it failed, with what would fix it. Stage 65's two forms stay for when the download is off.
- **The callers' arrival** adds a line to some cards. The line of code at the top of the window is held in place, as it is when guardrail marks arrive (`holdTopLine`), and the landing doesn't play.
- The overview's outside nodes appear with them.

### 4. The switch, and saying what's kept

- `--no-download` turns it off.
- The startup summary says that a repository with no clone on this machine is downloaded, where to, and `--no-download`; or that it's off.
- `doctor` checks git is there, and lists the copies with their size.

## Not in this stage

- **Reading the PR's own files from the copy** instead of the host's API, callers of callers, and unchanged functions on a call path: the rest of ARCHITECTURE.md "Later" item 1.
- **Borrowing from a found clone that lacks the commit,** so only the difference is downloaded. Not tried.
- **Leaving out files over 1 MB.** It saved 1 second and 6 MB on graal, and a file left out is downloaded one by one when something asks for its size.
- **The whole history,** and the host's tarball, which can't download only what changed.
- **Fetching into the reviewer's clone.**

## Tests

No test touches the network: the remote is a bare repository in a temporary folder, over `file://`, with fetching by SHA allowed.

- **The download:** a commit arrives and reads through the `LocalCheckout` contract suite; the ref is made; a second commit transfers fewer objects than the first; two requests for one repository make one download; a cancel and a timeout leave no half-made copy that's read; a missing commit and a refused remote give their reasons.
- **The lockdown,** on the calls a fake runner records: no shell, the environment's config, the token in no argument and no file.
- **Adding callers,** with fakes: they arrive on the same analysis ID with the reviewer's drafts; nothing but the four fields changes; an analysis stored as `20+checkout` is found; a model run in flight is waited for; a run during a download reads no callers; a failed download leaves the review complete with its reason; a restart recovers.
- **Forgetting:** a copy unread for 30 days is removed, and one read yesterday isn't.
- **The page:** the note's forms, and the top line held when callers arrive.
- **End to end,** on the fake server, with a pull request of its own added for this (the small-feature fixture is relied on elsewhere): callers arrive after the page opened.

## Definition of done

- [x] The check above, recorded.
- [ ] Contract change commit, with the stage 02 change log line.
- [ ] Tasks above, with the tests. Coverage holds for `domain` and `application`.
- [ ] On delphi-code #2, the real server with `--no-search`, started outside a clone, downloads the repository and shows the same six callers as stage 30's notes, on the analysis that opened without them. On oracle/graal #15134, the time from opening the PR to the callers, written into the notes.
- [ ] ARCHITECTURE.md: "Local checkout" says where the copies are, how they're downloaded and locked down, when they're removed, and the alternatives rejected; "Analysis pipeline" says the key no longer names the checkout and how callers are added; "Later" item 1 says what's left. DESIGN.md says why megareviewer downloads without being asked and what turns it off. The CLI's usage text and the README say `--no-download`.

## Open issues

- **Tokens not checked.** GitHub was checked with the GitHub CLI's OAuth token (`repo` scope) only: no fine-grained or classic personal access token was on the machine. A fine-grained one needs Contents: read, which megareviewer's API calls need anyway. A real Bitbucket app password couldn't be checked: Atlassian removed them in July 2026.
- **Private forks not checked,** on either host: every fork tried was public.

## Notes for later stages

### The check, 2026-11-25

With git 2.50.1 (Apple's), no system or global config, HTTPS only, no credential helper, no redirects, the credentials as an `http.<origin>/.extraHeader` in the environment, `git fetch --depth 1 --no-tags <url> <sha>` into an empty bare repository:

1. **GitHub, a private repository: works.** As `x-access-token:<token>`, its newest commit in 1.0 s and an older one in 0.7 s. The three sources end in one field of the config, so the one token on the machine, from `gh auth token`, stands for them; see the open issue. Without a token, or with a wrong one, git says `could not read Username … terminal prompts disabled`; for a repository the token can't see, `Repository not found`; for a commit that isn't there, `upload-pack: not our ref`.
2. **GitHub, a PR from a fork: works** from the base repository by its SHA, on 4 of 4: open (cli/cli #15111), merged and closed (sindresorhus/got #2458 and #2445), and closed with the fork deleted (got #2456).
3. **Bitbucket, a private repository: works with the scoped API token,** not with the user megareviewer's API calls send. `x-bitbucket-api-token-auth:<token>`, the user's Bitbucket username and `x-token-auth` download; the email gets `could not read Username`. The token here is in `BITBUCKET_USERNAME` and `BITBUCKET_APP_PASSWORD`, an email and an `ATAT…` token, which the API takes, so what decides the user for git is whether the username is an email, not which variables it came from.
4. **Bitbucket, a PR from a fork: works** from the destination repository for every PR megareviewer can open. Of 23 PRs from public forks in three public repositories, 17 have their head commit in the destination, by the API and by git, and all 17 downloaded, signed in, in 1.1 to 1.8 s. The other 6 answer 404 to the API's commit and diff in the destination, so megareviewer can't open them at all, and git says `not our ref`. The fork's name isn't needed. One fork that's gone (aws-s3-deploy #48) downloads from the destination and not from the fork.
