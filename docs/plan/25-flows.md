# Stage 25: Tour by flows

**Status:** Not started
**Depends on:** 24, and hints that follow imports (c5c0d9d)
**Unblocks:** an overview diagram to replace the call tree, and chip rules on the map
**Owns:** `src/domain/review/code-tour.ts`, `src/domain/review/entry-points.ts` (new), `src/domain/diff/call-graph.ts`, the tour's step headings in `web/src/pages/review/` (`MapLayout.tsx`, `RiskRail.tsx`, `model.ts`, `palette.ts`)

## Goal

Without the model, the tour's steps are whatever the call graph happens to connect: one step for everything linked, titled by a chain of symbols, and one step per unlinked file, titled by its path. A reviewer can't tell what step 4 is about.

This stage makes each step a **flow**: one entry point a user or caller can reach (an HTTP route, a page, a command), and the changed code it runs, read from the entry down. Code that several flows run is read in the first and pointed to from the others. What no flow runs goes into a few **supporting** steps with plain titles: API schema, docs, other changes.

## Why, measured

On delphi-code #2 (48 hunks), after hints started following imports:

- Grouping by what's connected gives 8 steps. Step 2 holds 33 hunks and is titled `connection_changes → account_connections → forget_saved_token and 7 more`. Five steps are one file titled by its path.
- Graph roots alone make poor entry points. A scratch prototype that started flows at hunks nothing calls picked `app.py`'s router registration as the entry of everything, because registering the router references the routes. Two host classes reached only through their base class became flows of their own. Import-only hunks, request and response models, and generated types joined nothing.
- With explicit entry markers, wiring read before what it wires, and leftovers attached by file, type use and test, the same PR reads as three flows and three supporting steps (the target below).

## Read first

- [DESIGN.md](../../DESIGN.md) principle 3, "Guided tour"
- [ARCHITECTURE.md](../../ARCHITECTURE.md) "2. Deterministic prep"
- [Stage 19](19-code-tour.md), whose `codeTour` this replaces, and [stage 04's notes](04-tree-sitter.md#notes-for-later-stages) on how hints follow imports
- `src/domain/review/code-tour.ts`, `src/domain/review/tour.ts`, `src/domain/review/validation.ts`, `src/domain/diff/call-graph.ts`

## Target on delphi-code #2

| # | Step | Reads | With it |
|---|---|---|---|
| 1 | `/api/account-connections`: GET, PUT `/{domain}/token`, DELETE `/{domain}/token` | `hosting_services.py` routes → `application.py` → `remote_repositories.py` → `hosts.py` (both host classes) → `keychain.py` | `app.py` wiring first; request and response models; import hunks; `test_http_api.py`, `test_picker.py`, `test_sources.py`, `fakes.py`, `fake_keychain.py` |
| 2 | Page: `SetupPage` | `setup.tsx` → `ConnectionsSection.tsx` | `setup.test.tsx` |
| 3 | Command: `main` in `hosts.py` | `hosts.py` `main` | Passes through step 1's host code |
| 4 | API schema | `openapi.json`, `schema.d.ts` | |
| 5 | Docs | `CONTRIBUTING.md` | |
| 6 | Other changes | `CredentialsGuide.tsx` | |

The three routes share one hunk, so they're one flow. Splitting a hunk by definition is out of this stage.

## Contract change

A separate PR, with a line in stage 02's **Change log**:

- **`CallGraphHint` gains `use: "call" | "type"`.** Type uses come back from `buildCallGraphHints`, at most 10 per hunk on top of the 10 calls. They only attach type definitions to the flow that uses them. Chips and the call tree keep showing calls only.
- **`TourStep` gains `kind: "flow" | "supporting"` and `via: HunkId[]`:** hunks of earlier steps the flow passes through, in reading order. The model's tour pass sets `kind: "flow"` and `via: []`.
- **The pipeline carries changed definitions to `codeTour`:** a hunk ID → names map that prep builds from the symbols it already parses. It isn't stored, because the tour is.
- `PIPELINE_VERSION` goes from 5 to 6. The fakes, fixtures and dev fixtures get `use`, `kind` and `via`.

## Tasks

### 1. Entry points: `src/domain/review/entry-points.ts`

`entryOf(file, hunk, changedDefinitions)` returns `{ kind: "route" | "page" | "command", label }` or null. It reads only added lines, so moving old code doesn't make an entry. The markers are a table, one row per framework:

- **Routes:** an HTTP verb and a path string on an added line, such as `@router.put("/p")` and `@app.route("/p")` (Python), `router.get("/p"` and `app.post('/p'` (JavaScript/TypeScript), `@GetMapping("/p")` (Spring), or `HandleFunc("/p"` and `r.GET("/p"` (Go). The label is `PUT /p`.
- **Pages:** a capitalized function or class in a `.tsx` or `.jsx` file under `routes/`, `pages/`, `app/`, `screens/` or `views/`. The label is `Page: Name`.
- **Commands:** a changed `main` definition, or `if __name__ == "__main__"`. The label is ``Command: `main` in file.py``.

Several routes in one hunk make one flow. The title is their shared path prefix, then each verb and the rest of its path. Entries that change the same definition in different hunks are one flow.

### 2. Flows: `codeTour`

1. **Graph:** hunks are nodes and call hints are edges, without test files.
2. **Wiring:** a hunk nothing calls whose callees are all entries, like registering a router. It's read first in the flow of its first callee.
3. **Entries:** marked hunks, then roots: hunks with no production caller that call something.
4. **Order:** flows that reach contract hunks first, then routes, pages, commands and roots, then diff order.
5. **Walk:** each flow walks its callees depth first. A hunk not yet read belongs to the flow. One already read goes into the flow's `via`.
6. **Roots that add little:** a root whose reachable hunks are mostly read already joins the flow it shares the most with, after that flow's hunks, instead of making a flow. Host classes reached through a base class land here.
7. **Attach the rest, in this order:**
   1. A type definition joins the flow that uses it as a type.
   2. Any other hunk joins the flow with the most hunks of its file. Import hunks land here.
   3. A test hunk joins the flow it calls into, through other tests and fakes, then its test file's flow, then its subject's flow by name (stage 19's rule), then the flow of the file its stem names (`fake_keychain.py` goes with `keychain.py`).
   4. A doc joins the flow of the code in its directory when there's exactly one.

### 3. Supporting steps

After the flows, contract ones first:

- **API schema:** files the schema rule matches (`openapi`, `swagger`, `.graphql`, `.proto` and the rest), and files whose first lines say they're generated (`@generated`, `auto-generated`, `DO NOT EDIT`). This only groups them. They stay visible, because a header is no proof.
- **Docs:** Markdown no flow took.
- **Tests:** tests no flow took.
- **Other changes:** the rest, grouped by area as in stage 19.

### 4. Titles and explanations

- **Title:** the entry's label for a flow, the group's name for a supporting step. No invented prose.
- **Explanation:** "Reads `routes.py`, `app.py` and 3 more; tested in `test_api.py`; passes through step 1."

### 5. The map

- **Flow heading:** the label, and the entry kind as a small tag (route, page, command).
- **`via` links:** "Passes through step 1: `hosts.py` lines 65–128 ↑", one link per hunk, going to it the way the call chips do.
- **Supporting headings** are quieter than flow headings.
- **The rail** heads each section with the label, cut short with the full text on hover.
- **The palette** lists flows by label.

The call tree doesn't change.

## Not in this stage

- **Splitting a hunk by definition,** so three routes in one hunk make three flows. It needs partial hunk cards and reviewed state per part.
- **The overview diagram** that replaces the call tree.
- **Chip rules on the map:** a chip only at the first call in a flow, and one chip for an ambiguous call.
- **Cross-language links,** such as a page calling a route through a path string or generated client.
- **Calls passed as arguments.** `Depends(delphi_code_of)` and `response_model=X` aren't references yet; type uses cover the models.
- **The model's tour.** With `--ai` it still writes its own steps.

## Tests

- **Routes:** each framework's marker is found on an added line, and not on a context or deleted line.
- **Several routes in one hunk** make one flow, titled by their shared prefix.
- **Wiring:** a registration hunk is read first in its entry's flow, not made an entry.
- **Shared code:** a hunk two flows reach is read in the first and is in the second's `via`.
- **Roots that add little:** two classes reached only through their base class join the flow, not two flows.
- **Attachment,** one test each: a type definition, an import hunk, a test through a fake, a test helper by stem, a doc.
- **Supporting steps:** a schema file and a generated header group under API schema, and stay required hunks.
- **Order:** a flow reaching a contract hunk comes before one that doesn't. Supporting steps come after every flow.
- **Property test:** over random files and hints, every required hunk is in exactly one step, `via` only names hunks of earlier steps, and `validateTour` passes.
- **Fixture:** a synthetic PR shaped like delphi-code #2, with a Python backend, three routes in one hunk, a service, two host classes, a keychain module, tests, a fake and a TSX page, gives the target above.
- **Map:** component tests for the flow heading, the `via` links and the supporting heading.

## Definition of done

- [ ] Contract change: `CallGraphHint.use`, `TourStep.kind` and `via`, changed definitions in the pipeline, and a change log line in stage 02.
- [ ] `entryOf` and the new `codeTour`, with the tests above; 90% branch coverage holds.
- [ ] The map shows flow headings, `via` links and supporting steps.
- [ ] On delphi-code #2, measured from the local cache as in commit c5c0d9d, the tour matches the target above, or the differences are written in **Notes for later stages**.
- [ ] ARCHITECTURE.md's tour bullet in "2. Deterministic prep" describes flows, and says why grouping by what's connected was replaced.

## Open issues

_None yet._

## Notes for later stages

_None yet._
