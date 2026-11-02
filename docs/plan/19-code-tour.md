# Stage 19: Tour from the call graph

**Status:** Done (pushed to main without a PR)
**Depends on:** 18 (for `isTestFile`)
**Unblocks:** 20, 22
**Owns:** `src/domain/review/code-tour.ts` and its tests

## Goal

Build the tour with deterministic code: start at the entry point, follow the calls, and keep each test next to the code it tests. The result replaces the file-order fallback whenever the model's tour isn't there, so the review reads as a story without the model.

## Read first

- [DESIGN.md](../../DESIGN.md) principle 3, "Guided tour"
- [ARCHITECTURE.md](../../ARCHITECTURE.md) "2. Deterministic prep" (call-graph hints) and the tour limits in "3. Model passes"
- `src/domain/diff/call-graph.ts`, `src/domain/review/tour.ts`, `src/domain/review/validation.ts`

## Contract change

`Tour.fallback: boolean` becomes `Tour.builtBy: "model" | "code" | "file-order"`, since a tour built by code is no longer a fallback. Stored analyses with the old field no longer parse, and the store already treats those as absent, so they're analyzed again. A separate PR, with a line in stage 02's **Change log**; it touches `MainArea.tsx` and the Claude adapter's tour pass.

## Tasks

### `codeTour(files, requiredHunkIds, callGraph, risk): Tour`

1. **Units.** One unit per file with a required hunk. A test file (`isTestFile` from stage 18) joins the unit of its subject: `foo.test.ts`, `foo.spec.ts`, `__tests__/foo.ts` with `foo.ts` in the parent directory; `foo_test.go` with `foo.go`; `test_foo.py` and `tests/test_foo.py` with `foo.py`; `FooTest.java` with `Foo.java`. A test with no subject in the PR is its own unit. A Markdown file joins the unit of the code in its directory when there is exactly one; otherwise it's its own unit.
2. **Graph.** Unit A points to unit B when a hint goes from a hunk in A to a hunk in B. Hints within one unit don't count.
3. **Steps.** Each weakly connected group of units is one step. Within a step, units are ordered by a depth-first walk from the units nothing else in the group points to (the entry points), callers before callees. A cycle is entered at its riskiest unit. Ties go to the unit with more contract hunks, then by path.
4. **Isolated units,** with no edges, are grouped into one step per area: the unit's first three directories (`src/adapters/github`, `web/src/diff`). A lone unit's step is titled by its path, a group's by its area.
5. **Step order.** Steps holding contract hunks come first, by their contract hunk count; then the rest by path of their first unit.
6. **Hunks** within a unit are in file order, the subject's before its tests'.

Every required hunk is in exactly one step; mechanical hunks are in none. `validateTour` must pass on every output.

### Titles and explanations

No prose is invented. A step's title is its longest call chain of symbols from the hints, up to three: `` `login()` → `verifySession()` → `loadKey()` ``, with "and N more" for the step's units not on the chain. A step without a chain is titled by its directory (`src/adapters/github`). The explanation lists the step's files and test files: "4 files in src/api and src/auth, tested in session.test.ts."

### Limits

No cap on steps. The 7-step limit in ARCHITECTURE.md is for the model; capping here would mean merging unrelated code into one step. A PR with 40 unrelated directories gets 40 steps.

## Tests

- A caller, a callee and the callee's test form one step: caller, callee, test.
- Two unrelated call chains give two steps; the one with a contract hunk comes first.
- A cycle doesn't loop and every hunk appears once.
- Test pairing for each convention above, and a test whose subject isn't in the PR.
- Hints between hunks of one file don't create a step boundary or a self-edge.
- Property test: over random files and hints, every required hunk appears exactly once and `validateTour` passes.

## Definition of done

- [x] Contract change: `Tour.builtBy`, change log line in stage 02.
- [x] `codeTour` exported from `src/domain/review/index.ts`.
- [x] Tests above; 90% branch coverage holds.

## Open issues

_None yet._

## Notes for later stages

- **Reading order in a group** is depth first from the riskiest entry point, so a callee shared by two entry points is read after the first one, before the second.
- **A unit's own hunks** come in file order, then its tests', then its doc's.
