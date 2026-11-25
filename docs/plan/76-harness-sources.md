# Stage 76: The harness from GitHub and Bitbucket

Planned and committed as stage 66.

**Status:** Not started
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

- [ ] `GitHubHarnessSource` and `BitbucketHarnessSource` pass `HarnessSource`'s contract suite.
- [ ] Fixtures recorded from real responses, or marked `synthetic` with the recorder left in place: GitHub's tree, a truncated tree and a blob query with `oid`; Bitbucket's diffstat, one with a rename and one paged.
- [ ] A test that the computed hash of a fixture file equals git's own for it (`git hash-object`'s value, written in the test).
- [ ] The direction of Bitbucket's diffstat spec is verified against a recording and noted here: which commit goes first for "what changed from the old base to the new one".
- [ ] A request count test per host through `loadHarness` with the fake store: GitHub, one tree request and no blob request on a base commit whose files are all stored; Bitbucket, one diffstat and no file request when nothing in the harness changed.
- [ ] `compose.ts` gives `AppDeps.harnessSource` each configured host's source.
- [ ] Live, on megareviewer's own repository and on one Bitbucket repository: the harness found, the requests made on a first load and on a second at a newer base commit, written into the notes.

## Out of scope

- A checkout-backed source.
- Using GitHub's tree to find files nothing links.

## Notes for later stages

None yet.
