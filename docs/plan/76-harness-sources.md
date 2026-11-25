# Stage 76: The harness from GitHub and Bitbucket

Planned and committed as stage 66.

**Status:** Done on `claude/harness-second-8cfed6` (`a63ec3c`, `d2023fc`, `0620e38`, `6567a88`). `pnpm check`: 214 test files, 4,243 passed, 6 skipped, no dependency violations.
**Depends on:** 75
**Owns:** `HarnessSource` in `src/adapters/github/` and `src/adapters/bitbucket/`, their fixtures and recorder scripts, their wiring in `src/cli/compose.ts`

## Read first

- [Stage 75](75-harness-core.md): the `HarnessSource` port, its contract suite, and how `loadHarness` uses each answer.
- `src/adapters/github/github-host.ts`: `getFiles`, a GraphQL query per 3 files, 6 at a time.
- `src/adapters/bitbucket/bitbucket-host.ts`: `getFiles`, a request per file, 18 at a time.
- ARCHITECTURE.md, "Git hosts": the timeouts, retries and batch sizes both hosts follow.

## Goal

Both hosts implement `HarnessSource`, so a PR opened on either loads its repository's harness. Each does only what its API can, and says null for the rest.

## Decisions

- **GitHub lists.** One request to the git trees API at the base commit, recursive, gives every path with its blob hash. A tree GitHub cuts short (`truncated`) is null, never a partial list: a missing root would read as a repository without one.
- **GitHub's blob hash is GitHub's.** `readFiles` asks for `oid` beside the text in the query `getFiles` already makes.
- **Bitbucket can't list, and says what changed.** Its listings and file metadata carry no blob hash, only the commit asked at, checked on a public repository on 2026-11-25. `changedPaths` is one `diffstat` request between two commits, a renamed file counting as both its paths. A diffstat over its page limit is null, so the use case walks afresh.
- **Bitbucket's blob hash is computed.** SHA-1 over `blob`, the byte length and the content, as git does, so both hosts key the store alike and a later checkout-backed source reads the same keys.
- **Reads go through the retrying wrapper,** as every host read does, with the batch sizes `getFiles` has.

## Definition of done

- [x] `GitHubHarnessSource` and `BitbucketHarnessSource` pass `HarnessSource`'s contract suite.
- [x] Fixtures recorded from real responses, or marked `synthetic` with the recorder left in place: GitHub's tree, a truncated tree and a blob query with `oid`; Bitbucket's diffstat, one with a rename and one paged.
- [x] A test that the computed hash of a fixture file equals git's own for it (`git hash-object`'s value, written in the test).
- [x] The direction of Bitbucket's diffstat spec is verified against a recording and noted here: which commit goes first for "what changed from the old base to the new one".
- [x] A request count test per host through `loadHarness` with the fake store: GitHub, one tree request and no blob request on a base commit whose files are all stored; Bitbucket, one diffstat and no file request when nothing in the harness changed.
- [x] `compose.ts` gives `AppDeps.harnessSource` each configured host's source.
- [x] Live, on megareviewer's own repository and on one Bitbucket repository: the harness found, the requests made on a first load and on a second at a newer base commit, written into the notes.

## Out of scope

- A checkout-backed source.
- Using GitHub's tree to find files nothing links.

## Notes for later stages

### Where the code differs from this doc

- **Files are read 3 a GraphQL query, 6 queries at a time, and 18 at a time on Bitbucket,** inside the adapters. Collect's batches give a PR's files those sizes, and `loadHarness` asks for a hop's files in one call. The first version took the adapters' own limits, 25 a query one after another and 8 at a time, and these notes said the documented sizes weren't in the code: they're in `collect.ts`. A lost request still retries the whole hop, where Collect's retries its batch.
- **A symlink isn't in GitHub's list.** Its blob holds a path: `sindresorhus/is` has a `CLAUDE.md` that links to `AGENTS.md`, and its harness is `AGENTS.md` alone. A submodule isn't either. In a tree GitHub cuts short, and on Bitbucket, a link can't be told from a file, and is read as the host gives it.
- **A file over 1 MB isn't downloaded:** GitHub's query says its size, and Bitbucket's answer its length. One GraphQL cuts short under that is read whole over REST, as `getFiles` does.
- **A directory on Bitbucket is told by its answer,** a listing in JSON. A file comes as text or binary, a `.json` file too.
- **`changedPaths` follows up to 10 pages of 500,** and past them, or where Bitbucket times out producing the diffstat, says null.
- **`retryingHarnessSource`** is in `src/application/retries/`, which this stage was given.

### Bitbucket's diffstat spec

The new commit goes first, `diffstat/{new}..{old}`: in the recording, `b467819..9c2e7d9` lists the file the newer commit adds with `old: null`. `topic=false` is needed too. Between two commits that diverged (`atlassian/aui`, `eeda066` and `450892f`), it listed the same 432 files in either direction, where `topic=true` listed 432 in one and 6 in the other, since it starts from the merge base. The default listed 432 in the direction tried.

### Live, on 2026-11-25

| Repository | Load | Requests | Time | Harness |
|---|---|---|---|---|
| markdorofeev/megareviewer, GitHub | First, `61bd0ac` | 1 tree, 26 file queries | 6.0 s; 7.6 s as 6 queries of up to 25 | 73 files, 1.0 MB, not cut, 13 dead links |
| | Second, `ebd66b6`, 3 days newer | 1 tree, 2 file queries | 2.5 s | 73 files, 1.0 MB |
| | The same again | none | 1 ms | |
| atlassian/aui, Bitbucket | First, `865f546` | 5 files | 1.2 s | `CONTRIBUTING.md` |
| | Second, `e9ba9f6`, 700 files apart | 1 diffstat, on 2 pages | 1.2 s | the same |
| atlassian/bitbucket-upload-file, Bitbucket | First, `9c2e7d9` | 8 files | 1.7 and 2.6 s | `CONTRIBUTING.md` and 3 files it links |
| | Second, `b467819` | 1 diffstat | 0.4 s | the same |
| sindresorhus/is, GitHub | First | 1 tree, 1 file query | 1.3 s | `AGENTS.md` |
| torvalds/linux, GitHub | First | 1 tree, cut short, 1 file query | 6.1 s | none, its five roots asked for |

The last one downloads a 71,474-entry tree GitHub has cut and can't use it. A repository that size pays it once a base commit.

Not checked: a symlink on Bitbucket, and a repository whose harness changed between two commits there.
