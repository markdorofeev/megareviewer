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

### Less on each part

The first file cards were checked live and read as messy: each part kept three rows of chrome (its header, Called from, Related parts), red four ways (band, reason, badge, bar), and its hunk's reason, which on a split hunk names definitions only its other parts change. So:

- A part's divider is one line: lines, what it changes, counts, callers in other files and Related parts. Callers in the same file are dropped there, since the card is that file.
- A part's risk is a bar beside its lines; its tooltip is the reason from the part's own lines (`ruleReasons`, run on the part), or "Contract with the rest of its hunk" when they match no rule.
- The file's header counts its contract parts and names each rule once, with the names it found across the parts (`mergedReasons`).
- The rail shows a file with several parts in a step as one row: its bars in a column, the name once.
- Gap rows use the body font, without a background.

### Risk per part, calls in the code

Without the hunk's reason, a part red only for its hunk's other parts showed a red bar nobody could explain. On delphi-code #2, `account_connections` and `_refreshed_connection` were red because git put them in hunks with `save_token` and `forget_saved_token`. And each first call was a chip row, though on a file card it usually opened a part a few lines down. So:

- The page runs the rules on a split part's own lines when they made its hunk's risk (`partIndex`): a part that matches none is logic. The model's risk stays per hunk. The header's totals count a hunk contract when any of its parts is.
- A contract part's reason is back on its divider, its own; the file header only counts contract parts.
- A first call is the symbol in the code: a click opens the called part under the line, and `o` still does. Requests and symbols reaching several hunks keep their chip row: 11 rows on delphi-code #2, 6 ambiguous and 5 requests.
- The divider links to callers in other steps only, and shows Related parts only when the rest of its hunk is in another step.
- The rail lists a file's name once, then a short row per part.
- A divider drops the part's lines and counts, which the gutter and the file's header give, and a part with nothing else to say has none.
- A divider drops git's section heading (`const BASE = "b".repeat(40);` over a hunk that changes a comment). A card of its own keeps it, beside the file's path.

## Measurements

The same analysis, before and after, read from the page: 79 cards before, 37 after, one per file per step. Every part is still on the page once.

## Notes for later stages

- **Unchanged lines between parts aren't expandable.** The page has no file contents, only hunks. Expanding them needs an API route that serves a file at the head commit, which the server already caches in `file_contents`.
- **A mechanical hunk on a file card** still shows as its collapsed row, which repeats the path.
- **A card of its own still shows git's section heading,** which can name an unchanged function above the added code (`def _host_of` over the new `_account_connection`). Naming the definitions an unsplit hunk changes, as a split part's header does, would fix it there too.
