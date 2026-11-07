# Stage 28: Hunks split by definition

**Status:** In progress (on main)
**Depends on:** 26 (chip rules keep the extra calls in check), 27
**Unblocks:** 29, whose links land on one route instead of a hunk of three
**Owns:** `src/domain/diff/parts.ts` (new), `src/domain/diff/call-graph.ts`, `src/domain/review/code-tour.ts`, `entry-points.ts`, `validation.ts`, `src/application/use-cases/prep.ts`, `model-input.ts` (hints mapped to hunks), `web/src/pages/review/` (cards, rail, reviewed state), `web/src/diff/HunkCard.tsx` (partial cards), the "Hunk" and new "Part" rows of ENGINEERING.md's ubiquitous language

## Goal

A hunk is whatever git put between two unchanged stretches. When it holds several definitions, the tour can only place it once: three routes added in one hunk make one flow, and every service method they call lands in that flow.

This stage splits a hunk into **parts**, one per definition it changes, wherever the parts belong in different steps. A part is read in its own flow, gets its own chips, and is marked reviewed on its own. A hunk that isn't split is one part, with the hunk's ID, so most of the page and every stored mark read as before.

## Why, measured

On delphi-code #2, with today's tour:

- `routes/hosting_services.py` adds `GET`, `PUT` and `DELETE` in one 39-line hunk, so step 1 is `/api/account-connections: GET, PUT /{domain}/token, DELETE /{domain}/token` and holds 32 of the 48 hunks.
- 19 of the 39 hunks that change a definition change more than one. `hosts.py:65` changes 14 (the `RepositoryHost` class and its token methods), `remote_repositories.py:29` changes 6, and `keychain.py` is one 59-line hunk with 8.

A prototype split each hunk at the outermost definitions inside it, joined unchanged stretches to the next part, built the flows from the parts, then joined back the consecutive parts of a hunk that landed in the same step. It kept test files whole:

| # | Step | Parts | Passes through |
|---|---|---|---|
| 1 | `GET /api/account-connections` | 40, from 32 hunks | |
| 2 | `PUT /api/account-connections/{domain}/token` | 13, from 8 hunks | 14 parts |
| 3 | `DELETE /api/account-connections/{domain}/token` | 5 | 17 parts |
| 4 | Page: SetupPage | 5 | |
| 5 | Command: main in hosts.py | 5 | |
| 6–8 | API schema, other changes in `web/src/picker`, docs | 7 | |

That's 75 parts: 8 hunks split, the other 40 whole. The DELETE flow reads as one chain through five files: `forget_account_token` → `forget_saved_token` in `application.py`, `remote_repositories.py` and `hosts.py` → `forget_secret`. Splitting without joining back gave 115 parts, with `hosts.py` in 29 pieces, too fine to read.

Step 1 is still large: what no flow runs joins the flow with most of its file, and GET comes first. That's a rule of stage 25's, written under **Not in this stage**.

## Read first

- [ENGINEERING.md](../../ENGINEERING.md) §2 (a new term goes in the ubiquitous language first) and §6 "Fail safe toward the reviewer"
- [Stage 25](25-flows.md) and its notes, [stage 26](26-chip-rules.md)
- `src/domain/diff/call-graph.ts` (`changedDefinitions`), `src/domain/review/code-tour.ts`, `validation.ts`, `src/application/use-cases/prep.ts`, `model-passes.ts`
- `web/src/pages/review/ReviewPage.tsx` (reviewed marks, `reviewOrder`, `decisionPlaces`), `RiskRail.tsx`, `web/src/diff/HunkCard.tsx`

## Contract change

A separate commit, with a line in stage 02's **Change log**, after ENGINEERING.md gains the term:

| Term | Meaning |
|---|---|
| Part | The lines of a hunk that change one definition, identified by a part ID. A hunk that isn't split is one part. |

- **`PartId`:** a hunk ID, or a hunk ID and `.n` (`h_0123456789abcdef.2`). A hunk that isn't split has one part whose ID is its hunk ID.
- **`HunkPart`:** `{ id, hunkId, start, end, definitions }`, where `start` and `end` index the hunk's `lines` (end excluded). **`Analysis.parts`** lists the parts of split hunks only.
- **`CallGraphHint.fromHunkId` and `toHunkId` become `fromPartId` and `toPartId`.** The model's input maps them back to hunks and drops duplicates, so prompts and evals don't change.
- **`TourStep.hunkIds` becomes `partIds`**, and `via` and `entries` hold part IDs. The model's `TourStepDraft` keeps `hunkIds`; the server expands each hunk to its parts in order.
- **Unchanged per hunk:** risk, proofs, decisions, verdicts and comments. A mechanical hunk is never split: its proof is about the whole hunk.
- `PIPELINE_VERSION` goes from 7 to 8. The fakes, fixtures and dev fixtures use the new names.

## Tasks

### 1. Parts: `src/domain/diff/parts.ts`

`splitByDefinition(hunk, definitions)` returns the hunk's candidate parts:

- **Where to cut:** at the outermost definitions that start or end inside the hunk. A definition that holds the whole hunk, like the class around a block of methods, doesn't cut, so its methods do.
- **Unchanged stretches** (context only) join the next part, or the previous one at the end. A part always adds or deletes something.
- **Deleted lines** go with the definition around them in the base file, and stay in diff order. Prep parses the base file's symbols for this; today it parses only the head's.
- **Tests split too,** one part per test, so a test can join the flow it calls. The table above was measured with test files whole, so its test counts may move.
- **One candidate,** or a hunk with a proof, means no split.

### 2. Prep and the tour

1. Prep cuts every required hunk into candidates and builds hints and changed definitions on them, treating each as a hunk.
2. `codeTour` builds flows from the candidates, as from hunks today.
3. **Join back:** consecutive candidates of one hunk that landed in the same step become one part again. Their `via` entries and hints are renamed to it. A hunk whose candidates all landed together is whole again, with its hunk ID.
4. The parts that remain are stored in `Analysis.parts`, the hints and the tour name them.
5. **Wiring by part:** a part that only registers routes, like `router = APIRouter()` and `connection_changes`, is read first in the first route flow it registers. The prototype put them in the PUT flow.

### 3. Validation

`validateTour` checks that every part of every required hunk is in exactly one step, and that `via` names parts of earlier steps. A model tour's hunk counts as all of its parts.

### 4. The page

- **Partial cards.** A part's card shows its own lines. The header says the definition and where the rest of the hunk is: "`save_token` · part 4 of 10 · rest of this hunk in steps 1 and 3". A fold row above and below links to the neighboring parts. A hunk that isn't split looks as today.
- **Reviewed per part.** The stored reviewed marks hold part IDs. A hunk counts as reviewed in the header when all its parts are, so the count stays in hunks. A mark on a hunk that's split now covers all its parts once, then is replaced by per-part marks.
- **Rail:** one bar per part.
- **Chips and mentions** point at parts, with stage 26's rules.
- **Comments** stay on lines. A draft shows in the part that holds its line.
- **Decisions:** a decision's card sits on the first part, in map order, of the first hunk it rests on. Its other parts link to it.
- **Mechanical hunks in place** keep their place by hunk, next to the first part of their file in the step.

## Not in this stage

- **Smaller first flows.** On delphi-code #2 the GET flow keeps 32 hunks, because attachment gives a file's leftovers to the flow with most of it. Attaching by the definition a part's code is nearest to, instead of by file, is the next lever.
- **Splitting for the model.** The model's passes keep seeing whole hunks.
- **Splitting by statement** inside one long definition.

## Tests

`splitByDefinition` gets the adversarial treatment mechanical proofs get: a wrong cut hides lines from the part they belong to.

- Cuts: three routes in one hunk; methods inside a class that holds the whole hunk; a hunk that's one definition (no split); a new file with several components; a hunk with a proof (no split).
- Lines: unchanged stretches join the next part; a deleted definition goes with its base-side place; decorators and comments above a definition go with it.
- Property test: over random hunks and definitions, a hunk's parts cover its lines exactly once, in order, and each part adds or deletes a line.
- Join back: two candidates in one step become one part; all candidates in one step give back the hunk ID.
- The tour: a synthetic PR shaped like delphi-code #2 gives the three route flows above, with the router read first in the GET flow.
- `validateTour`: a missing part, a part in two steps, a model step naming a split hunk.
- The page: a partial card's header and fold rows, a reviewed mark per part, a hunk counted reviewed once all its parts are, a stored hunk mark covering its parts, and a decision card on its first part.

## Definition of done

- [ ] ENGINEERING.md's ubiquitous language has "Part", then the contract change commit with the stage 02 change log line.
- [ ] Tasks above, with the tests; 90% branch coverage holds.
- [ ] On delphi-code #2, `pnpm measure` shows the steps in the target above, or the differences are in **Notes for later stages**.
- [ ] Evals run once, to confirm the model's results didn't change with the hint mapping.
- [ ] Checked in the browser on delphi-code #2 and the 240-hunk dev fixture.
- [ ] ARCHITECTURE.md "2. Deterministic prep" describes parts, why a hunk is split, and why parts join back (115 parts unjoined on delphi-code #2).

## Open issues

_None yet._

## Notes for later stages

_None yet._
