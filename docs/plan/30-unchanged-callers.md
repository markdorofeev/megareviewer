# Stage 30: Unchanged callers from a local checkout

**Status:** In progress (on main)
**Depends on:** 27 (the overview shows them); after 28, so callers point at parts
**Unblocks:** the rest of ARCHITECTURE.md "Later" item 1 (full repository context from the checkout)
**Owns:** `src/application/ports/local-checkout.ts` (new), `src/adapters/git/` (new), `src/domain/diff/call-graph.ts` (callers outside the PR), `src/application/use-cases/collect.ts` and `prep.ts`, `src/cli/` (finding the checkout), the callers list in `web/src/pages/review/` and the overview's outside nodes

## Goal

The page shows only the changed code. When a PR changes what an existing function does, the code that already calls it, unchanged, is where a regression shows up, and the reviewer has to find it by hand.

This stage reads the PR's repository from a **local checkout**, when megareviewer runs in one, and shows the **unchanged callers** of each definition the PR changes:

- On a hunk card: "Used unchanged in 3 places", each with its file, line and a few lines around it.
- In the overview: each caller file as a faded node outside the PR, grouped by directory when there are many.

It's the first use of reading the local checkout (ARCHITECTURE.md "Later" item 1), and builds only the part this needs: find the checkout, check it has the PR's commits, and read files at the head commit.

## Why, measured

On delphi-code #2, with the checkout at `~/Projects/work/delphi-code` (head `c07d2c5`, 238 files at that commit):

- 29 definitions the PR changes existed before it, outside tests.
- Matching their names across the repository finds 357 uses in 83 unchanged files, almost all noise: `state`, `to_json`, `main` and `repositories` are common names.
- Following imports, as hints do, over the 186 unchanged files tree-sitter parses: 30 uses in 27 files, 11 of them calls. 15 are type uses of `DelphiCode`, which the PR changes only by adding methods.
- What's left is what a reviewer should see. `sources.py:169` calls `clone_credentials`, whose order of credentials the PR changes (saved tokens now come before the others). `server.py`, `export_openapi.py` and `test_front_end_contract.py` call `create_app`, which now registers the new router. `ServiceStep.tsx` renders `CredentialsGuide`, which the PR changes.

## Read first

- [ARCHITECTURE.md](../../ARCHITECTURE.md) "Shape" (why a local process can read the checkout) and "Later" item 1
- [ENGINEERING.md](../../ENGINEERING.md) §8 (no new dependency without a reason) and §9 (privacy)
- [Stage 04's notes](04-tree-sitter.md#notes-for-later-stages) and `src/domain/diff/call-graph.ts`, `imports.ts`
- `src/application/use-cases/collect.ts`, `prep.ts`, `src/cli/compose.ts`

## Contract change

A separate commit, with a line in stage 02's **Change log**:

- **A `LocalCheckout` port:** `hasCommit(sha)`, `listFiles(sha)` and `readFile(sha, path)`, with typed errors for a missing commit and an unreadable file. A fake that serves fixture files, and a contract suite.
- **`Analysis.unchangedCallers`:** `{ partId, path, line, symbol, use, excerpt }[]`, where `excerpt` is at most 5 lines around the use. `Analysis.checkout` says whether one was read, and if not, why: none found, or the commit missing.
- `PIPELINE_VERSION` goes from 9 to 10. An analysis made with a checkout and one made without differ, so the version says which, as it says whether the model ran.

## Tasks

### 1. Finding the checkout

- `--checkout <dir>`, or else the directory megareviewer runs in.
- It's used when one of its git remotes names the PR's repository (`github.com/owner/repo` or `bitbucket.org/workspace/repo`, over SSH or HTTPS), and it has the PR's head commit. Without it, `doctor` says so and suggests `git fetch`.
- Never fetches, checks out or writes anything: the reviewer's working tree stays as it is.

### 2. The git adapter: `src/adapters/git/`

`git` run with `execFile`, no shell and no new dependency: `cat-file -e` for `hasCommit`, `ls-tree -r --name-only` for `listFiles`, and `cat-file --batch` for reading many files in one process. A file over 1 MB is skipped, as in `file_contents`, and counted.

### 3. Callers

1. **Which definitions:** those that exist in the base file and whose own lines the PR adds or deletes, not counting nested definitions. Adding methods to `DelphiCode` doesn't make its users callers of a change.
2. **Which files:** unchanged files in a language tree-sitter parses whose imports reach a changed file, the same rules hints use. A file that imports nothing changed isn't parsed.
3. **Which uses:** calls and type uses of those definitions, with `buildCallGraphHints`' visibility rules. Type uses of generated files don't count.
4. **Limits:** at most 50 callers per changed definition, the rest counted as "and N more". The count is always shown, never dropped silently.

### 4. The page

- **Hunk cards:** "Used unchanged in 3 places" under the header of the part that changes the definition, opening a list of excerpts with their file and line. Tests are counted apart, as in stage 26's callers.
- **The overview:** a faded node per caller file outside the PR, below the file it calls, with a dashed edge. Above 10 such nodes, they group by directory.
- **The palette:** "Used unchanged" lists the definitions with callers.
- Without a checkout, the header's Details say why, and nothing else changes.

## Not in this stage

- **Using the checkout for the PR's own files** instead of the host's API, which is the rest of "Later" item 1.
- **Callers of callers.** One level only.
- **Unchanged functions on a call path** between two changed hunks (stage 24's **Not in this stage**). They need the same reading, and come after.
- **Sending callers to the model.**

## Tests

- Finding the checkout: SSH and HTTPS remotes, a fork's remote that doesn't match, a missing commit.
- The git adapter's contract suite, run against a temporary repository made in the test, and the fake.
- Callers:
  - a call in an unchanged file that imports the changed one;
  - the same name in a file that doesn't import it (no caller);
  - a class whose PR only adds methods (no caller);
  - a type use of a generated file (no caller);
  - the limit and its count.
- The page: the card's count and excerpts, the overview's outside nodes and their grouping, and Details without a checkout.

## Definition of done

- [ ] Contract change commit, with the stage 02 change log line.
- [ ] Tasks above, with the tests. Coverage holds for `domain` and `application`.
- [ ] On delphi-code #2 with its checkout, the callers include `sources.py:169` for `clone_credentials`, `create_app`'s three, and `ServiceStep.tsx` for `CredentialsGuide`, and none of the `DelphiCode` type uses. `pnpm measure` prints them. Differences go in **Notes for later stages**.
- [ ] ARCHITECTURE.md: "Shape" says the checkout is read when present and never changed, and "Later" item 1 says what's left.

## Open issues

_None yet._

## Notes for later stages

_None yet._
