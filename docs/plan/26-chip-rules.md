# Stage 26: Fewer chips on the map

**Status:** In progress (branch stage/26-chip-rules)
**Depends on:** 25
**Unblocks:** 28, which multiplies calls by splitting hunks
**Owns:** `scripts/measure-pr.ts` (new) and its `measure` script in `package.json`, `web/src/pages/review/MapLayout.tsx`, `HunkView.tsx`, `model.ts` (`callsByLine`, `hunkLinks`, `firstCall`), `chips.ts` and `Peek.tsx` (new), `review.css`, the links in `web/src/diff/HunkCard.tsx`

## Goal

Every call to a changed hunk gets a chip under its line, and every hunk lists each caller as "called by X ↑". On a PR whose flows call the same code again and again, the chips repeat what the reader has already seen, and the caller list buries the one link that matters.

After this stage a call gets a chip only where it helps:

- **The first call in a flow** to a hunk gets a chip, as today.
- **A later call** in the same flow to the same hunk underlines the symbol. Hovering or focusing it shows a peek of the called code, and a click goes there.
- **An ambiguous call,** one symbol on one line that reaches several hunks, is one chip listing them.
- **"Called by X"** becomes the caller's files: "Called from `application.py`, `test_picker.py`", one link per file.

## Why, measured

On delphi-code #2 (48 hunks, today's prep and tour rebuilt from the cache):

- 54 call chips on 47 lines in 18 hunks. 29 of them call a hunk an earlier chip in the same step already opens.
- 6 lines hold more than one chip. On 5, one symbol reaches several hunks: `_account_name` on `hosts.py:485` makes three chips to three hunks of the same file, and `forget_saved_token` on `test_picker.py:528` makes one to `hosts.py` and one to `fakes.py`.
- 54 "called by" links over 22 hunks, at most 6 shown per hunk out of 17 for the busiest. They come from 29 caller files, at most 4 per hunk.

With the rules below: 24 chips (3 of them merged ambiguous calls), 24 underlined mentions, and at most 4 caller-file links on a hunk.

## Read first

- [Stage 24](24-code-first-review.md), task 4 and its notes on `signatureOf`: a card redraws only when its signature changes
- [Stage 25](25-flows.md), for what a flow is on the map
- `web/src/pages/review/MapLayout.tsx`, `HunkView.tsx`, `model.ts`, `ReviewPage.tsx` (`signatureOf`, `openCalls`, the `o` shortcut)
- `web/src/diff/HunkCard.tsx` (`belowLine`, the "Called by" list)

## Contract change

None. The hints already carry the symbol and its line.

## Tasks

### 0. A measuring script: `scripts/measure-pr.ts`

Every stage in this slice measures itself on delphi-code #2. The script makes that one command instead of a scratch file per stage:

- `pnpm measure <analysis id>` reads the analysis's PR and diff from `~/.megareviewer/db.sqlite`, the file contents from `file_contents`, and runs today's prep, rule risk and code tour on them, the way the pipeline does without the model.
- It prints the files with their hunks and risk, the tour's steps, and the counts this slice tracks: call hints, chips under these rules, lines with more than one chip, "called by" links and caller files.
- It reads the database read-only and never calls a host. A file missing from the cache is listed, not fetched.

Later stages add their own counts to it.

### 1. Which calls get a chip: `chips.ts`

A pure `chipPlan(sections, calls)` over the map's sections in order. For each hunk and line, it returns chips and mentions:

- **Reading order** is the map's: sections in order, hunks in section order, lines in hunk order.
- **A chip** for a call whose called hunk no earlier call in the same section reached. Before the tour exists, the one "files" section counts as one flow.
- **A mention** for every later call to that hunk in the section: the symbol is underlined where it stands on the line.
- **One symbol, several hunks:** the calls on one line with the same symbol are one entry. It's a chip when any of its hunks is new to the section, and a mention otherwise.
- **The symbol isn't on the line's text,** say a call spread over lines: the mention stays a chip. When unsure, show more.

Nested cards, opened from a chip, keep a chip for every call, as today: they're how the reader walks down a call stack.

### 2. The ambiguous chip

`account → 3 places`. Clicking it lists the hunks it reaches, with each one's file, lines and risk. Picking one opens it inline, as a chip does today. Arrows and Enter work in the list, and Esc closes it.

### 3. Underlined mentions and the peek: `Peek.tsx`

- The symbol is underlined (dotted, in the called hunk's risk color) and is a button.
- Hovering for 300 ms or focusing it shows a peek: the called hunk's file and lines, its risk class, the step it's in, and up to 12 lines of the hunk from the definition the symbol names, or from its start.
- A click, or Enter, goes to the called hunk at its own place, the way "called by" links go now, so Esc comes back.
- The peek closes on Esc, on leaving the symbol, and on scroll. One peek is open at a time.

### 4. Callers by file

The "Called by" list under a hunk's header becomes one line: "Called from `application.py`, `remote_repositories.py` and 2 tests".

- One link per caller file, in map order, going to that file's first hunk that calls this one.
- Production files first, then test files counted as "N tests", which expand to their links on click.
- A file that calls the hunk only through mentions still counts: it calls it.

### 5. The page

- `signatureOf` includes whether each call on the card is a chip or a mention, and whether a peek is open on it.
- `o` opens the focused hunk's first chip. With no chip, it goes to its first mention's hunk.
- The shortcuts dialog doesn't change.

## Not in this stage

- **The call tree.** Stage 27 replaces it, so its chips stay as they are.
- **Fewer hints.** The rules hide nothing: every call is still a chip or a mention, and every caller file is listed.
- **Chips across flows** that the reader has already opened in another step. The rule counts within a section only, so each flow reads on its own.

## Tests

- `chipPlan`:
  - the first call to a hunk in a section is a chip, a second call in the same section a mention, and a call in the next section a chip again;
  - one symbol reaching two hunks on one line is one entry, a chip when either hunk is new;
  - two symbols on one line are two entries;
  - a symbol not found on the line's text stays a chip;
  - the "files" section before the tour counts as one flow;
  - property test: every call hint is in exactly one chip or mention.
- The ambiguous chip lists its hunks and opens the picked one inline.
- A mention shows the peek on hover and focus, closes it on Esc, and goes to the hunk on click.
- Callers by file: two hunks of one file make one link; tests are counted after production files and expand.
- A card redraws when its chip turns into a mention.
- `measure-pr.ts` prints the counts above for a fixture database.

## Definition of done

- [ ] Tasks above, with unit and component tests.
- [ ] On delphi-code #2, `pnpm measure` gives 24 chips, 24 mentions and at most 4 caller-file links per hunk, or the differences are written in **Notes for later stages**.
- [ ] Checked in the browser on delphi-code #2 and on the 240-hunk dev fixture: a key still redraws in about 60 ms.
- [ ] ARCHITECTURE.md "Review page", Map bullet, says when a call gets a chip, and why: chips on every call repeated what the reader had seen.

## Open issues

_None yet._

## Notes for later stages

_None yet._
