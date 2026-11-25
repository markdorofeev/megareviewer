# Stage 65: A clone found on this machine

**Status:** Done (branch claude/full-repo-checkout-feasibility-c87b42, no PR)
**Depends on:** 30
**Unblocks:** 66
**Owns:** the `LocalCheckouts` and `LocalCheckout` ports and their fake and contract suite, a `KnownCheckouts` port, `src/adapters/git/`, the `known_checkouts` table in `src/adapters/sqlite/`, `lookUpCheckout` and `readUnchangedCallers` in `src/application/use-cases/unchanged-callers.ts` and their callers in `analyses.ts`, `checkoutDir` on the analysis and in `contracts/`, the `--no-search` flag, the startup summary and `doctor`'s checkout check in `src/cli/`, the checkout note in `web/src/pages/review/ReviewPage.tsx`, and "Local checkout" in ARCHITECTURE.md

## Goal

Code outside the PR that calls what it changes is shown only when megareviewer is started inside a clone of the PR's repository that already has the PR's head commit. A reviewer who starts it anywhere else gets none, and a note telling them to restart.

This stage has megareviewer find the clone itself. For a PR it tries, in this order, and reads the first that has the head commit:

1. **The folder it was started in,** or the one given with `--checkout`. As today.
2. **A clone it read before** for this repository, remembered in the store.
3. **A clone found by searching the home folder.**

When none has the commit, the review opens without the callers, as today, and the note says what was found. Stage 66 adds a download after that.

Nothing megareviewer finds is ever changed: no fetch, no checkout, no write.

## Why, measured

On the author's machine, 2026-11-25:

- Walking the home folder six folders deep, with the skips below, found all 20 clones in 0.04 s.
- `git remote -v` in each of the 20 took 0.37 s. Reading each clone's `.git/config` as a file needs no process.
- Spotlight answered "folders named `delphi-code`" in 0.1 s: the clone, and three folders that aren't clones.
- The delphi-code clone's remote still names its owner's old account, so the remote can't be the only way to match. All 20 clones sit in a folder named after their repository.
- On oracle/graal at PR 15134's head (21,587 files): the commit check took 0.5 s, listing the files 1.1 s, reading all 16,579 Java files 3.3 s, and `git grep` for two names followed by reading only the 383 files that mention them 0.3 s.

## Read first

- [ARCHITECTURE.md](../../ARCHITECTURE.md) "Local checkout", "Storage" and "Local server security"
- [Stage 30](30-unchanged-callers.md) and its notes
- `src/adapters/git/`, `src/application/ports/local-checkout.ts`, `src/application/use-cases/unchanged-callers.ts` and `analyses.ts`, `src/cli/main.ts` and `doctor.ts`

## Contract change

A separate commit, with a line in stage 02's **Change log**. The shapes below are a proposal; record what differs.

- **`LocalCheckouts`** answers three questions instead of one, each with the checkout, its folder and whether a remote names the repository:
  - `pointedAt()`: the checkout megareviewer was pointed at, or null.
  - `at(dir)`: the checkout in a folder read before, or null when it's gone.
  - `search(repo)`: the clones on this machine that could be the repository's. Empty when the search is off.
- **`LocalCheckout.filesMentioning(sha, names)`**: the paths at the commit whose text holds any of the names. It may answer more files than really use a name, never fewer.
- **`KnownCheckouts`**, a small port of the store: the folders read before for a repository, most recent first, and `remember(repo, dir)`.
- **`Analysis.checkoutDir`**: the folder that was read, or the one that names the repository without the commit; null otherwise and on stored analyses. No pipeline version bump: nothing an analysis contains changes.

## Tasks

### 1. The order

`lookUpCheckout` tries the three in the order above and stops at the first with the head commit. It doesn't search when an earlier one has it. When none has the commit, it answers `missing-commit` with the first folder that names the repository, else `none`. A folder that was read is remembered.

A folder named after the repository whose remote names another one is read only if it has the head commit, which is what pins the content.

### 2. Searching the home folder

In `src/adapters/git/`, with the home folder, the file system and the clock passed in so tests control them.

- A clone is a folder with a `.git` folder in it. A `.git` file is a worktree, whose clone is found on its own.
- At most 6 folders deep.
- Skipped: `Library`, folders whose name starts with a dot, `node_modules`, and at the top of the home folder `Documents`, `Desktop`, `Downloads`, `Pictures`, `Music` and `Movies`, which macOS asks permission for.
- A clone isn't searched for more clones. Symlinks aren't followed.
- It stops after 2 seconds or 2,000 clones, and says so in the startup summary, `doctor` and the log.
- Each clone's remotes come from its `.git/config`, read as text and mapped with `repoOfRemote`. No git process per clone.
- A clone could be the repository's when a remote names it, or its folder has the repository's name, whatever the case.
- The walk runs once at startup. A lookup that finds nothing walks again, at most once a minute, so a repository cloned while megareviewer runs is found without a restart.

On a Mac only, a lookup that found nothing in the walk also asks Spotlight for folders with the repository's name: `mdfind`, without a shell, 2 seconds at most. A result counts when it has a `.git` folder and isn't under `Library`. This is what finds `~/Documents/GitHub/<repo>`, where GitHub Desktop clones. The name goes into a query, so a name outside `[A-Za-z0-9._-]` isn't asked about.

git runs only in a folder that could be the repository's, to check the commit, and then to read. It already runs in whatever folder megareviewer is started in.

### 3. Clones read before

A `known_checkouts` table: host, owner, repo, folder, last read. A row whose folder is gone is dropped when it's looked up.

### 4. The switch, and saying what's searched

- `--no-search` turns the home folder search off. The other two still apply.
- The startup summary's `Checkout` line stays. A line after it says the home folder is searched, how many clones the walk found, and `--no-search`; or that the search is off.
- `doctor` says the same, and lists the remembered folders.

### 5. The page

The Details dialog's note, in [ReviewPage.tsx](../../web/src/pages/review/ReviewPage.tsx):

- **A clone without the commit:** names the folder, "Run `git fetch` in `~/Projects/work/shop`", with the fork line for GitHub as today.
- **No clone:** "megareviewer found no clone of acme/shop on this machine", and that it looked in the home folder, or that the search is off.

### 6. Fewer files read for callers

`readUnchangedCallers` asks `filesMentioning` first and reads only the candidates it answers. `mentionsAny` still decides on what's read, so the callers are the same. The adapter runs `git grep` with fixed strings over the commit's tree, without a path list, since 16,579 paths don't fit on a command line. The warning about files over 1 MB then counts only the ones that mention a name.

## Not in this stage

- **Downloading the repository** when no clone has the commit. Stage 66.
- **Folders the reviewer names,** `--repos` or a variable, and the folders beside the checkout megareviewer runs in. The home folder search covers the second; the first is for code outside the home folder, and waits until someone needs it.
- **Other tools' lists of projects.** Claude Code, Cursor and JetBrains each keep one; they're other programs' files, and the walk finds the same folders.
- **Fetching into a found clone.** It would write into the reviewer's repository.

## Tests

- **The walk,** in temporary folders: a clone at depth 6 is found and one at 7 isn't; a clone inside a clone, a `.git` file, a symlink loop and a dot-folder; the skipped folders are never opened; both caps and what they report; a second walk only after a minute.
- **Matching:** by remote over HTTPS and SSH, by folder name, a remote naming an old owner, and a `.git/config` that doesn't parse.
- **Spotlight:** a fake `mdfind`; a result without `.git`; a result under `Library`; a name with a quote in it is never asked about; nothing is run off a Mac.
- **The order,** with fakes: the folder pointed at wins; a remembered folder comes before the search and is dropped when it's gone; the search isn't run when an earlier one has the commit; a clone of another repository under the same folder name isn't read without the commit.
- **`filesMentioning`** in the contract suite, against the fake and a temporary repository: the same callers as reading every file, on stage 30's cases.
- **The CLI and the page:** `--no-search`, the summary's line, `doctor`, and the note's two forms.

## Definition of done

- [x] Contract change commit, with the stage 02 change log line.
- [x] Tasks above, with the tests. Coverage holds for `domain` and `application`.
- [x] On delphi-code #2, the real server started in a folder that isn't a clone and without `--checkout` reads the clone it finds: the same six callers as stage 30's notes. Started again, it reads the remembered folder without searching. With `--no-search` in a store that remembers nothing, the note says no clone was found.
- [x] ARCHITECTURE.md: "Local checkout" says the order, what the search reads and skips, and the alternatives rejected; "Storage" lists `known_checkouts`. The CLI's usage text and the README say `--no-search`.

## Open issues

_None yet._

## Notes for later stages

Where the code differs from or adds to this doc:

- **Live check on delphi-code #2,** 2026-11-25, the built server started in a folder that isn't a clone, without `--checkout`, on an empty store: the summary said 20 clones were found (the walk took 0.04 s), the analysis read `~/Projects/work/delphi-code` in 5.4 s, and the callers are stage 30's six: `create_app` in `server.py:16`, `export_openapi.py:12` and `test_front_end_contract.py:73`, `clone_credentials` in `sources.py:169`, `FakeHost` in `e2e_server.py:19`, `CredentialsGuide` in `ServiceStep.tsx:29`. Started again with the analysis removed from the store, it read the remembered folder; so it did with `--no-search`, where there's no search to fall back on. On an empty store with `--no-search` the analysis is `none`, and the page's note says no clone was found and that the home folder wasn't searched. The clone's `.git` had the same files, sizes and times after as before. Spotlight alone, with the walk's results hidden, found the clone in 0.16 s.
- **Contract.** `pointedAt(repo)` and `at(dir, repo)` take the repository, since each answers whether a remote names it. `LocalCheckouts.searchFolder` and the status response's `cloneSearchFolder` say which folder is searched, null when the search is off: the note needs it, and shows a folder in it by `~`. `filesMentioning` replaces `listFiles`, which nothing else called, so listing a commit's files (1.1 s on graal) went with it. `KnownCheckouts` is `foldersRead`, `rememberFolder`, `forgetFolder` and `knownCheckouts`, the last for `doctor`. `LocalCheckouts` has a contract suite of its own.
- **A folder read before counts as one that names the repository,** whatever its remotes say, so a push the delphi-code clone hasn't fetched says to run `git fetch` there rather than that no clone was found.
- **Opening a PR again brings a complete analysis's `checkout` and `checkoutDir` up to date,** in `startFor`, so the note says what's on the machine now; analyses stored before this stage would otherwise say no clone was found. Nothing else on the analysis changes, and a run in flight is left alone. Stage 66's "callers added in place" is the larger form of it.
- **No lazy fetching.** A partial clone fetches what it lacks when a command asks for it, which would write into a clone megareviewer found. `runGit` sets `GIT_NO_LAZY_FETCH` and, for a git before 2.45, refuses every protocol. Stage 66's download can't use that environment, and needs a runner of its own. A partial clone's missing files are a warning on the analysis.
- **The walk** doesn't look inside a worktree either, and the home folder itself is never taken for a clone, since some keep their settings in a repository there. It's raced against the clock, so a folder that never answers can't hold it past 2 seconds.
- **Spotlight is asked within the home folder only** (`-onlyin`), since that's what the summary says is searched. Both the walk again and Spotlight run when the walk found no clone that could be the repository's, not when the ones it found lack the commit.
- **`doctor` takes `--no-search` too,** so it doesn't search what the reviewer turned off. Its `openStore` is async and answers the remembered folders. The startup summary is `startSummary` in `src/cli/summary.ts`, so it can be tested.
- For stage 66: `lookUpCheckout(deps, repo, headSha)` answers `{ status, dir, at }`, and `createGitCheckout` reads a bare repository as it is (`git grep` and `cat-file` were tried on one). A copy under megareviewer's home is never found by the walk, which skips dot-folders and bare repositories.
