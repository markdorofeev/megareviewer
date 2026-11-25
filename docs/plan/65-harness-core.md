# Stage 65: The harness: the domain, the ports, the store and loading

**Status:** In progress (branch claude/harness-core-4b758f)
**Depends on:** 55, 56
**Owns:** `src/domain/review/harness.ts`; the `HarnessSource` and `HarnessStore` ports, their fakes and contract suites; the harness tables and store in `src/adapters/sqlite/`; `src/application/use-cases/harness.ts`; the start of loading in `src/application/use-cases/analyses.ts`; their wiring in `src/cli/compose.ts` and `src/cli/dev/fake-app.ts`; the slice's text in DESIGN.md, ARCHITECTURE.md and ENGINEERING.md

## Read first

- [The slice in the plan README](README.md#eighteenth-slice-the-repositorys-harness), with the decisions every stage shares and the room it leaves for a full checkout.
- `src/application/use-cases/guidance.ts` and `src/domain/review/preference.ts`: how guideline files are read and switched today.
- `src/application/use-cases/analyses.ts`: how a run is started, joined and kept in `inFlight`.
- `src/application/ports/local-checkout.ts`: the shape a later source will have.

## Goal

Find the files a repository's guideline files link, at a PR's base commit, and have them in the store before the reviewer asks for an AI review. This stage builds the domain, the ports, the store and the use case, on fakes. It changes nothing a run reads: stages 67 and 69 do, and 66 brings the hosts.

## Decisions

This stage writes them into DESIGN.md and ARCHITECTURE.md, each with its alternatives.

- **The harness is found by links, from the five root files.** A link is an `@path` import, a relative Markdown link, or a path in prose, to a `.md`, `.mdc`, `.markdown` or `.txt` file. Nothing inside a code span or fence is a link, and neither is a URL, a path under `~`, or one that leaves the repository. Listing every Markdown file in the repository was the alternative: of megareviewer's 96, that adds the eval cases' fixture files and each adapter's `PROVENANCE.md`, which are nobody's rules. Links alone already reach about 70 files and 1 MB there, `CLAUDE.md` naming the plan README and the README linking every stage doc, which is why nothing but the roots is put in a prompt unasked (stages 67 and 69).
- **A link is resolved against the file it's in, then against the root.** An import and a Markdown link are relative to their file. A path in prose is tried both ways, since `docs/plan/README.md` in a root file and in `docs/notes.md` usually mean the same file.
- **The walk has limits, and says when it hit one.** 5 hops from a root, 200 files, and no file over 1 MB. A harness cut by a limit records which one, and the page says so (stage 68).
- **Loading starts when a PR's analysis is started,** for a new analysis and a cached one, and nothing waits for it. A run that starts while it's in flight joins it. Loading on Request AI review was the first version: the run then starts with requests to the host.
- **Loading can't fail an analysis or a run.** A harness that couldn't be loaded is a warning on the run, which goes on with the root files it can read as today.
- **The harness is stored per commit, its content per blob.** `harness_files` says which paths a commit's harness has and each one's blob hash; `harness_blobs` holds each blob's content once. Rebuilding the list from the file cache on every run was considered: it needs the cache keyed by commit, which is what refetched every file whenever the target branch moved.
- **How a source saves requests is the use case's, not the adapter's.** A source only lists, reads and says what changed; the use case picks the cheapest way those allow. So a new source, a checkout among them, brings no logic of its own.

## Contract

Follow the existing patterns for IDs, timestamps and schemas (Zod, `readonly`).

### Domain: `src/domain/review/harness.ts`

- `BlobHash`: git's blob hash, 40 hex characters.
- `HarnessLinkKind`: `"import" | "link" | "mention"`.
- `HarnessFile`: `{ path, blob: BlobHash, bytes, lines, via: "root" | HarnessLinkKind, linkedFrom: string | null, headings: { level, text, line }[] }`. `linkedFrom` is the first file found linking it, null for a root. `via` is the strongest kind any file links it by: import, then link, then mention.
- `Harness`: `{ baseSha, files: HarnessFile[], cut: "depth" | "files" | null, skipped: { path, reason: "too-large" | "unreadable" }[] }`. Files are in the order the walk found them: roots in `GUIDELINE_PATHS` order, then breadth-first in link order.
- `MAX_HARNESS_DEPTH = 5`, `MAX_HARNESS_FILES = 200`, `MAX_HARNESS_FILE_BYTES = 1_048_576`, `MAX_INLINE_BYTES = 65_536`.
- Pure functions:
  - `harnessLinks(path, content)`: the paths a file links, resolved and normalized, each with its kind, in the order they appear, each once.
  - `harnessOutline(content)`: its headings with their 1-based lines, and its line count.
  - `harnessEnabled(path, harness, switches)`: whether a run may use a file. A root is on by `guidelineEnabled`. Any other file is on unless its own switch is off, and only when an enabled root reaches it through enabled files.
  - `harnessPlan(harness, switches)`: the enabled files in two lists. `inPrompt`: the enabled roots in `GUIDELINE_PATHS` order, then the files they import breadth-first in the order written, each taken while it fits what's left of `MAX_INLINE_BYTES`, a file that doesn't fit passed over and the next tried. `onRequest`: every other enabled file, nearest a root first. Stage 67 sends the first, stage 69 serves the second.
- The `guideline_switches` table already takes any path. The route that sets one accepts only the five until stage 68.

### Ports

- `HarnessSource`, in `src/application/ports/harness-source.ts`:
  - `listFiles(repo, sha)`: every path at the commit with its blob hash, or null when the source can't list.
  - `readFiles(repo, sha, paths)`: for each path its content and blob hash, or null when it isn't at the commit.
  - `changedPaths(repo, fromSha, toSha)`: the paths that differ between the two commits, or null when the source can't say.
  - Each returns a `Result` with a `HostError`. A source computes the blob hash itself when its host doesn't give one, so the application never hashes.
- `HarnessStore`, in `src/application/ports/harness-store.ts`: `getHarness(repo, sha)`, `putHarness(repo, harness)`, `latestHarness(repo)`, `getBlobs(repo, blobs)`, `putBlobs(repo, entries)`, `dropBlobsUnusedSince(time)`.
- `AppDeps.harnessSource(repo)`: the source for a repository, the one place a later stage adds a checkout-backed one. Today it's the repository's host's, or null for a host without one, which loads nothing.

### Storage

- `harness_files (host, owner, repo, sha, position, path, blob, bytes, lines, via, linked_from, headings)`, with the harness's `cut` and `skipped` on a row of `harnesses (host, owner, repo, sha, loaded_at, cut, skipped)`.
- `harness_blobs (host, owner, repo, blob, content, used_at)`. Rows unused for 30 days are dropped at start, as `file_contents` rows are, and so are harnesses older than that.

### Use case: `src/application/use-cases/harness.ts`

`loadHarness(deps, repo, baseSha)` returns the harness with its files' contents, a `Result`, and never throws:

1. The store has this commit's harness: return it, with no request.
2. The source lists: take the roots it lists, walk their links, read only the blobs the store doesn't have.
3. Otherwise, the store has the repository's latest harness and the source says what changed since its commit: reuse every file that didn't change, read the ones that did, and walk on from them. A root that the change adds is found the same way.
4. Otherwise walk from the five roots, reading each hop in one `readFiles`.

Two calls for one repository and commit join, as two starts of one analysis do. `startAnalysis` calls it without awaiting it, once the PR's base commit is known.

## Definition of done

- [ ] `harness.ts` with the types and functions above, and tests for the links: imports, Markdown links, mentions, both resolutions, code spans and fences, URLs, `~`, `..` out of the repository, anchors and a file that links itself.
- [ ] Adversarial tests for the walk: a cycle, a chain deeper than 5, more than 200 files, a file over 1 MB, a link to a directory.
- [ ] The two ports, in-memory fakes, and a contract suite each that the fakes pass.
- [ ] The SQLite store passes `HarnessStore`'s suite; a migration adds the tables.
- [ ] `loadHarness` tested on each of its four paths with a fake source that counts requests: none when stored, only changed blobs when listed, only changed paths after a diff, one read per hop otherwise.
- [ ] Two concurrent loads make one walk. A failing source is an error result and leaves the store as it was.
- [ ] Starting an analysis starts a load and doesn't wait for it; the analysis completes when the load fails.
- [ ] The fake app has a source with a root file that imports and links others, for stages 67 and 68.
- [ ] ENGINEERING.md has the terms: **Harness**, the guideline files at a repository's root and the files they link, at a PR's base commit; **Harness file**, one of them, with how it was found; and **Guideline file** now says it's a root of the harness.
- [ ] DESIGN.md and ARCHITECTURE.md have this stage's decisions and the storage table's new rows.

## Out of scope

- The hosts' sources (66), what a run reads (67, 69), the page (68).
- A checkout-backed source, and files nothing links: nested `AGENTS.md`, `.claude/rules/`, `.cursor/rules/`. A source that lists makes them cheap to add later.

## Notes for later stages

None yet.
