# Stage 33: One card per file in a step

**Status:** Done (on main, no PR)
**Depends on:** 32
**Owns:** The map's cards in `web/src/pages/review/` (`MapLayout.tsx`, the section order in `model.ts`) and the in-file header in `web/src/diff/HunkCard.tsx`

## Goal

A step showed its parts in call order, one card each, so a step that goes back and forth between two files cut each file into several cards, the path repeated on every card. Keep a step's parts from one file together, on one card.

## Baseline

On delphi-code #2 (`a_6843867360a49450`, without `--ai`): 79 parts in 10 steps, each a card. The shared step's 23 parts are in 8 files, but call order made 11 runs of one file. hosts.py is in 5 steps, and five other files are in 3.

## What changed

- `mapSections` orders a step's parts by file: the files in the order the step reaches them, a file's parts in the file's order. The rail, `j`/`k`, the reviewed count, the chip plan and decision placement all follow the section order, so they follow the cards.
- `MapLayout` puts consecutive parts of one file on a file card: path, status, part count, lines changed and one Reviewed mark (indeterminate when some parts are reviewed). A file with one part in the step keeps the part's own card, which names the file already.
- A part on a file card has a divider for a header: its lines, what it changes, its counts, contract reason and risk. Callers, unchanged uses, decisions and Related parts stay under it.
- Between two parts the card says how many lines lie between them, and links to the file's parts other steps read there.
- Reviewed marks are still stored per part, and `x` still marks the focused part.

## Measurements

The same analysis, before and after, read from the page: 79 cards before, 37 after, one per file per step. Every part is still on the page once.

## Notes for later stages

- **Unchanged lines between parts aren't expandable.** The page has no file contents, only hunks. Expanding them needs an API route that serves a file at the head commit, which the server already caches in `file_contents`.
- **A mechanical hunk on a file card** still shows as its collapsed row, which repeats the path.
- **The header of a hunk that isn't split** shows git's section heading, the definition the hunk starts in, which can name an unchanged function above the added code (`def _host_of` over the new `_account_connection`). It did that before this stage, too.
