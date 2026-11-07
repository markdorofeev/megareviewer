# Stage 27: Overview of the changed files

**Status:** Not started
**Depends on:** 25; after 26, because both change `ReviewPage.tsx`
**Unblocks:** 29 and 30, which add edges and nodes to it
**Owns:** `src/domain/diff/file-links.ts` (new), `web/src/pages/review/overview.ts` and `Overview.tsx` (new), `TreeLayout.tsx` and `call-tree.ts` (removed), the layout switch, shortcuts and palette in `web/src/pages/review/`, the "Review page" part of ARCHITECTURE.md "UI"

## Goal

The call tree is the page's second layout, and reviewers don't use it. It's a tree of symbols, so a hunk reached twice shows again as "above", tests sit among the roots, and nothing says how the changed files connect.

This stage replaces it with an **overview**: a small layered diagram of the changed files.

- **Entry points on top.** Files nothing in the PR calls go in the first row, and each file sits one row below its lowest caller. A file with an entry (a route, a page, a command) carries its label.
- **Edges** from imports and calls between changed files.
- **Color** by the file's highest risk class, **size** by lines changed.
- **Tests as badges** on the files they call, not as nodes. Test helpers, like fakes, count as tests.
- **Generated files faded.** Files no edge reaches sit in a strip under the diagram.
- **A click opens the code:** the map, scrolled to the file's first hunk in tour order.

The layout switch becomes "Map | Overview", still on `v`.

## Why, measured

On delphi-code #2, the call tree today:

- 42 rows for 29 hunks: 13 rows are "above" references to a hunk placed higher up.
- 7 roots, 3 of them test files (`test_http_api.py`, `test_picker.py`, `test_sources.py`), and one is `hosts.py` reached only through its own `_account_name` three times.
- 19 hunks in 13 files sit under "Not on a call path".
- Rows are symbols (`↑ _saved_token`, `isolate_git_and_gh`), so the reader can't see that the PR runs from the routes through the services to the host classes and the keychain.

The same PR has 21 changed files. Without tests, test helpers and docs, 15 are nodes. Call and type hints give 18 links between files; imports between changed files give 26, of which 8 the hints miss (`app.py → application.py` and test imports among them).

## Read first

- [DESIGN.md](../../DESIGN.md) principle 3, "Guided tour"
- [Stage 24](24-code-first-review.md), task 5 and 6 (the call tree and the switch this replaces), and [stage 25](25-flows.md) with its notes
- `src/domain/diff/imports.ts` (`importReach`), `src/application/use-cases/prep.ts`
- `web/src/pages/review/ReviewPage.tsx`, `TreeLayout.tsx`, `call-tree.ts`, `shortcuts.ts`, `palette.ts`

## Target on delphi-code #2

| Row | Files |
|---|---|
| 1 | `app.py`, `setup.tsx` (Page: SetupPage) |
| 2 | `routes/hosting_services.py` (3 routes), `ConnectionsSection.tsx` |
| 3 | `request_models.py`, `response_models.py`, `application.py`, `schema.d.ts` (faded) |
| 4 | `remote_repositories.py` |
| 5 | `hosts.py` (Command: main) |
| 6 | `domain/hosting_services.py`, `keychain.py` (contract) |
| Not linked | `openapi.json`, `CredentialsGuide.tsx`, `CONTRIBUTING.md` |

Badges: `test_http_api.py` on `app.py`, `application.py` and `domain/hosting_services.py`; `test_picker.py` on `hosts.py`, `keychain.py` and `domain/hosting_services.py`; `test_sources.py` on `hosts.py`; `fakes.py` on `domain/hosting_services.py` and `application.py`. `setup.test.tsx` and `fake_keychain.py` link to nothing, so they're listed in the strip. No test reaches the routes file itself: stage 29's links from test requests to routes add that badge.

Two files are named `hosting_services.py`, so a node's label is its name, plus as many parent directories as it takes to be unique.

## Contract change

A separate commit, with a line in stage 02's **Change log**:

- **`Analysis.fileLinks: { from: string; to: string }[]`:** changed files that an import in `from` reaches, from `importReach` over the imports prep already parses. Pure, in `src/domain/diff/file-links.ts`.
- **`Analysis.generated: string[]`:** the paths `looksGenerated` marks. Stage 25 passed them to the tour without storing them; the overview needs them on the page.
- **`TourStep.entries: HunkId[]`:** the hunks a flow starts at. Empty for supporting steps and the model's steps.
- `PIPELINE_VERSION` goes from 6 to 7. The fakes, fixtures and dev fixtures get the new fields.

## Tasks

### 1. The diagram's model: `overview.ts`

A pure `fileOverview(analysis, steps)`:

- **Nodes:** files with a hunk to review, without tests, test helpers (files only tests link to) and docs. Each has its path, label, added and deleted lines, highest risk class, whether it's generated, and its entry labels from `TourStep.entries`.
- **Edges:** `fileLinks` and call or type hints between two nodes, one edge per pair, marked by what it carries (import, call, type).
- **Rows:** a node's row is one more than its lowest caller's. A cycle is broken at the edge into the file earliest in tour order. Nodes no edge touches go in the strip, with the test files that link to nothing.
- **Order in a row:** two passes of ordering by the mean position of each node's callers, then tour order on ties, so edges cross less.
- **Badges:** each test or helper file is a badge on every node it links to, directly or through a helper.
- **Large PRs:** above 40 nodes, files group by directory, three levels deep as in stage 19. A group is one node that expands in place.

### 2. Drawing it: `Overview.tsx`

Inline SVG, with no new dependency.

- Node width follows lines changed, between a minimum that fits the label and a maximum. Fill follows risk with the page's palette; generated files are faded with a dashed border.
- Edges run from the bottom of the caller to the top of the callee. A call edge is solid, an import-only edge dashed, and a type edge dotted.
- Hovering a node highlights its edges and lists its flows by title. Hovering an edge names the symbols it carries.
- Reviewed state: a node shows a tick when all its hunks are reviewed, and a count otherwise.
- Keyboard: Tab goes through the nodes in row order, arrows move between them, and Enter opens the code.
- Clicking a node, or Enter, switches to the map and scrolls to the file's first hunk in tour order. Esc in the map goes back to the overview with that node focused.
- The diagram scrolls inside its box when it's wider than the page.

### 3. Remove the call tree

- `TreeLayout.tsx`, `call-tree.ts` and their tests go, with the tree's `→`, `←` and `j`/`k` rules and its "Next hunk in the tree".
- A stored layout of `tree` reads as `overview`.
- The palette, opened in the overview, selects the item's file node; Enter opens its code in the map.
- The shortcuts dialog lists the overview's keys.

### 4. Docs

ARCHITECTURE.md "Review page": the call tree bullet becomes the overview, with why the tree was replaced (the measurements above) and the alternative kept for later: a tree of flows from the tour instead of symbols.

## Not in this stage

- **Edges from frontend to backend.** Stage 29 adds them.
- **Unchanged files.** Stage 30 adds callers outside the PR.
- **Hunks in the diagram.** The overview stays at files; the map shows hunks.
- **A layout library** such as dagre or ELK. Rows by depth and two ordering passes are enough at 40 nodes, and a dependency in a tool that holds credentials needs a reason.

## Tests

- `fileLinks`: a relative import, a Python package import, a path alias, an import of a file outside the PR (no link), and a test importing code.
- `fileOverview`:
  - rows on a chain, a diamond and a cycle;
  - tests and helpers become badges, through a helper too;
  - a generated file is a faded node, not hidden;
  - unlinked files and tests go in the strip;
  - two files with one name get distinct labels;
  - over 40 nodes, files group by directory;
  - property test: every file with a hunk to review is a node, a badge or in the strip, exactly once.
- `Overview.tsx`: a click and Enter open the file's first hunk in the map, Esc comes back, and the tick shows when all its hunks are reviewed.
- Switching layouts: a stored `tree` opens the overview.

## Definition of done

- [ ] Contract change commit, with the stage 02 change log line.
- [ ] Tasks above, with unit and component tests. The Playwright test that switched to the call tree opens the overview, clicks a node and marks a hunk reviewed.
- [ ] On delphi-code #2, the overview matches the target above, or the differences are in **Notes for later stages**. `pnpm measure` prints the rows.
- [ ] Checked in the browser on delphi-code #2 and on the 240-hunk dev fixture.
- [ ] ARCHITECTURE.md "Review page" describes the overview.

## Open issues

_None yet._

## Notes for later stages

_None yet._
