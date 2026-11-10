# Stage 36: A directory tree beside the code, and the Overview by directory

**Status:** Done (on main, no PR)
**Depends on:** 35 (the page cut back to its primitives, commit `f0738ab`, which has no doc of its own)
**Owns:** The rail and the file in view in `web/src/pages/review/` (`tree.ts`, `TreeRail.tsx`, `useFileInView.ts`), the directory boxes in `overview.ts` and `Overview.tsx`, the file card's header in `MapLayout.tsx`, and `FilePath` in `web/src/diff/HunkCard.tsx`

## Goal

The reviewer needs to see where the code they're reading sits in the codebase. Directories are the one part of the codebase's structure we have without a checkout, and the old rail showed only each file's last path segment, so two `hosting_services.py` files read as one. Deterministic, no model calls, no pipeline change.

## Read first

- ARCHITECTURE.md, UI → Review page
- Stage 35's commit message, which lists what the page keeps

## The rail, beside the code

- A tree of the map's files. Directories are headings; a chain of directories with one child and no files is one heading (`web/src/`).
- One row per file: its name, and a red dot and a count when it has contract parts. No line ranges, no risk words, no rows per part.
- A directory heading carries the contract total of everything under it.
- The file in view is highlighted as the reviewer scrolls, and a click on a file scrolls to its card.
- For the file in view: an up arrow on each file that calls it, a down arrow on each file it calls, from the same file links the Overview draws. Other files are muted.
- The page's files are already in the tree's order (stage 35), so scrolling the code moves down the tree.
- At 1024px or less the rail is behind a button, as the old one was.

The file card's header shows the directory, muted, before the file name.

## The Overview

- Directories are the boxes at every size. A box names its directory, its file count and its contract parts, and is colored by its highest risk.
- Edges are the links between the directories' files, merged; a request keeps its own line.
- A box opens in place to its files, from a button on it. A click on the box goes to its first file in the code; Esc comes back.
- The directory of the file last in view in the code is outlined.
- Tests are badges on the directories they reach. Directories no edge touches go in the strip. Unchanged callers stay as they were.
- **Two directories that call each other:** the edge that links fewer pairs of files is drawn upward, so the directory with more calls into the other sits above it. On a tie, the edge into the directory a flow reads first is drawn upward, as for files.

## Definition of done

- [x] `pnpm check` passes.
- [x] On delphi-code #2 the rail lists 21 files under their directories and tells the two `hosting_services.py` files apart, and the Overview has about 8 boxes.
- [x] Component tests cover the tree's collapsing of chains, the totals, the highlight and the arrows.
- [x] ARCHITECTURE.md describes both, with the alternatives rejected (a bar per part, a node per file).

## What changed

- `tree.ts` builds the tree (`fileTree`) and holds `byTreePath`, so the overview orders a directory's files as the page does. `TreeRail.tsx` draws it; `useFileInView.ts` follows the card in view: the last whose top has passed a quarter of the window, or the last on screen once the page is at the bottom.
- `overview.ts` makes every directory a node (`group:<directory>`) holding its code, docs and the tests that reach no code; `expanded` opens one in place. `fileNeighbors` gives the rail the overview's file-to-file links. A node counts its contract parts with the page's per-part rule, which `contractParts` in `model.ts` shares with the card header.
- A click on a box goes to its first file's card; a button on a box with more than one file opens it in place. `v` from the map opens the overview on the focused card's file, or else the file in view.
- A merged edge with a request is drawn as a request.
- `FilePath` mutes the directory, everywhere it's used.

## Measurements

delphi-code #2 (`a_e4ebdbe1874e191f`, without `--ai`, with the checkout), checked live: the rail lists 21 files under `delphi_code/`, `tests/`, `web/` and the top level; `domain/hosting_services.py` and `http_api/routes/hosting_services.py` sit under their own headings. The Overview has 9 directory boxes in the diagram over seven rows, plus `tests/`, `web/` (openapi.json) and `./` (CONTRIBUTING.md) in the strip. `http_api/` and `http_api/routes/` call each other: routes calls two of http_api's files and http_api imports one of routes, so routes sits above and app.py's import runs up the side.

## Notes for later stages

- **"About 8 boxes"** came out as 9: every directory holding a changed code file is one. Merging a one-file directory into its parent would reach 8, but the rail and the boxes would then disagree on where a file is.
- **The file in view needs layout.** Tests have none, so the hook leaves it unset there and the page tests don't cover the outline; `fileInView` is tested as a pure function.
- **Tests that link nothing join their directory's box,** with docs, so the strip has directories only.
